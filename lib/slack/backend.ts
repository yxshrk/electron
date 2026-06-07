// Client for Yash's run APIs (InsForge-backed). Behind a mock toggle so the Slack surface is
// buildable/testable before /api/runs exists. REFLEX_BACKEND=mock (default in dev) -> in-memory.

import type {
  ConfirmInput, DraftConfig, MediaArtifactInput, ReportDraft,
  RunCreateInput, RunCreateResponse, RunEvent, SlackContextCandidate,
} from './contracts';
import * as mock from './mock-backend';

const DEFAULT_DRAFT_CONFIG: DraftConfig = {
  includeSlackHistory: true, messageLimit: 100, includeAttachments: true,
  attachmentLimit: 3, includeDebugCapture: true, maxPromptChars: 6000,
};

const useMock = (process.env.REFLEX_BACKEND ?? 'mock') === 'mock';
const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
const TERMINAL_STATUSES = new Set(['shipped', 'diagnosis_failed', 'dispatch_failed', 'reproduction_failed', 'pr_failed']);
// Event-poll window. Must outlast a full recorder session (open app, reproduce, narrate) plus the
// back-half pipeline, or the record flow's report_drafted/Confirm card is missed. 400 × 1.5s = 10 min.
const POLL_INTERVAL_MS = 1500;
const MAX_POLLS = 400;

interface RunDetailResponse {
  events?: Array<{
    id?: string;
    event_type?: string;
    eventType?: string;
    status?: string | null;
    title?: string;
    detail?: string;
    payload?: Record<string, unknown>;
    created_at?: string;
    createdAt?: string;
  }>;
  briefs?: Array<{
    id: string;
    where_it_happens: string;
    actual_behavior: string;
    expected_behavior?: string | null;
    reproduction_context?: string | null;
    affected_surface: ReportDraft['affectedSurface'];
    evidence_summary?: ReportDraft['evidenceSummary'];
    missing_info?: string[];
    agent_prompt_preview: string;
    status: ReportDraft['status'];
  }>;
  diagnoses?: Array<{ id: string; symptom: string }>;
  hypotheses?: Array<{ id: string; title: string; confidence?: number }>;
}

/** A diagnosis + its ranked hypotheses, for the Gate-2 "approve & dispatch" card. */
export interface DiagnosisSummary {
  symptom?: string;
  hypotheses: Array<{ id: string; title: string; confidence?: number }>;
}

type RunEventHandler = (e: RunEvent) => void | Promise<void>;

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

/**
 * Reads JSON from one of Yash's run APIs.
 *
 * @param path API path relative to `baseUrl`.
 * @returns Parsed JSON response typed by the caller.
 * @sideEffects Performs an HTTP GET against the configured app URL.
 */
async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${path} -> ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

/** C1: create a run from a slash command. */
export function createRun(input: RunCreateInput): Promise<RunCreateResponse> {
  return useMock ? mock.createRun(input) : post('/api/runs', input);
}

/** Store copied Slack context candidates. Yash's /context takes { messages } only (PR #8). */
export function postContext(runId: string, messages: SlackContextCandidate[]): Promise<{ ok: true }> {
  return useMock ? mock.postContext(runId, messages) : post(`/api/runs/${runId}/context`, { messages });
}

/** Store one media artifact's metadata after upload to Storage (section 8: one file per call). */
export function postMedia(runId: string, media: MediaArtifactInput): Promise<{ mediaArtifactId: string }> {
  return useMock ? mock.postMedia(runId, media) : post(`/api/runs/${runId}/media`, media);
}

/** Ask Yash to draft the confirmable report (section 8: config body). */
export function draftBugBrief(runId: string, config: DraftConfig = DEFAULT_DRAFT_CONFIG): Promise<ReportDraft> {
  return useMock ? mock.draftBugBrief(runId) : post(`/api/runs/${runId}/draft-bug-brief`, config);
}

/**
 * Reads the latest confirmable report draft for Slack edit modal rendering.
 *
 * @param runId Reflex run ID.
 * @returns Latest draft, or undefined when no brief exists.
 * @sideEffects Reads the real run detail API when mock mode is disabled.
 */
export async function getDraft(runId: string): Promise<ReportDraft | undefined> {
  if (useMock) return mock.getDraft(runId);
  const detail = await get<RunDetailResponse>(`/api/runs/${runId}`);
  const brief = detail.briefs?.[0];
  if (!brief) return undefined;

  return {
    runId,
    bugBriefId: brief.id,
    status: brief.status,
    whereItHappens: brief.where_it_happens,
    actualBehavior: brief.actual_behavior,
    expectedBehavior: brief.expected_behavior ?? undefined,
    reproductionContext: brief.reproduction_context ?? undefined,
    affectedSurface: brief.affected_surface,
    evidenceSummary: brief.evidence_summary ?? [],
    missingInfo: brief.missing_info ?? [],
    agentPromptPreview: brief.agent_prompt_preview,
  };
}

/**
 * Confirms the report and starts the backend's confirm-to-dispatch pipeline.
 *
 * @param runId Reflex run ID.
 * @param input Optional edited fields and confirmation metadata.
 * @returns Acknowledgement consumed by Slack interaction handlers.
 * @sideEffects Writes the confirmed package and lets the run API diagnose and dispatch.
 */
export async function confirmBugBrief(runId: string, input: ConfirmInput = {}): Promise<{ ok: true }> {
  if (useMock) return mock.confirmBugBrief(runId, input);
  await post(`/api/runs/${runId}/confirm-bug-brief`, input);
  return { ok: true };
}

/**
 * Reads the diagnosis + ranked hypotheses for the Gate-2 confirmation card.
 *
 * @param runId Reflex run ID.
 * @returns The symptom and ranked hypotheses (empty list if none / unavailable).
 * @sideEffects Reads the real run detail API when mock mode is disabled.
 */
export async function getDiagnosis(runId: string): Promise<DiagnosisSummary> {
  if (useMock) return mock.getDiagnosis(runId);
  try {
    const detail = await get<RunDetailResponse>(`/api/runs/${runId}`);
    return {
      symptom: detail.diagnoses?.[0]?.symptom,
      hypotheses: (detail.hypotheses ?? []).map((h) => ({ id: h.id, title: h.title, confidence: h.confidence })),
    };
  } catch {
    return { hypotheses: [] };
  }
}

/**
 * Gate 2: after the user approves the diagnosis in Slack, fire Yash's dispatch orchestrator
 * (`POST /api/runs/{runId}/dispatch`), which hands the top hypothesis to Luke's Replicas /
 * scripted-fallback path and opens the PR. Defaults to creating a real PR.
 *
 * @param runId Reflex run ID.
 * @param opts Optional hypothesis selection, provider, and createPr flag.
 * @returns Acknowledgement consumed by the Slack interaction handler.
 * @sideEffects Triggers reproduce → fix → PR through Yash's + Luke's routes.
 */
export function dispatch(
  runId: string,
  opts: { hypothesisId?: string; provider?: 'replicas' | 'scripted'; createPr?: boolean } = {},
): Promise<{ ok: true }> {
  if (useMock) return mock.dispatch(runId, opts);
  return post(`/api/runs/${runId}/dispatch`, { createPr: opts.createPr ?? true, ...opts }).then(() => ({ ok: true }));
}

/**
 * Subscribes to run events for Slack status mirroring.
 *
 * @param runId Reflex run ID.
 * @param onEvent Callback invoked for each new run event.
 * @returns Unsubscribe function.
 * @sideEffects Uses mock listeners in mock mode; otherwise polls the run detail API.
 */
export function subscribe(runId: string, onEvent: RunEventHandler): () => void {
  if (useMock) return mock.subscribe(runId, onEvent);

  let closed = false;
  const seen = new Set<string>();
  void pollRunEvents(runId, seen, onEvent, () => closed).catch((error) => {
    if (!closed) console.error(error);
  });
  return () => { closed = true; };
}

/**
 * Mirrors run events until a terminal run status or polling timeout.
 *
 * @param runId Reflex run ID.
 * @param onEvent Callback invoked for each new run event.
 * @returns Nothing after terminal status, polling timeout, or mock-mode listener setup.
 * @sideEffects Polls the real run detail API and runs the callback for each unseen event.
 */
export function mirrorEventsUntilTerminal(runId: string, onEvent: RunEventHandler): Promise<void> {
  if (useMock) return mock.mirrorEventsUntilTerminal(runId, onEvent);
  return pollRunEvents(runId, new Set<string>(), onEvent, () => false);
}

export const isMock = useMock;

/**
 * Polls the run detail API and emits unseen events to Slack.
 *
 * @param runId Reflex run ID.
 * @param seen Event IDs already emitted.
 * @param onEvent Callback invoked for each new event.
 * @param isClosed Whether the caller has unsubscribed.
 * @returns Nothing after a terminal status, timeout, or unsubscribe.
 * @sideEffects Performs repeated HTTP reads against the run detail API.
 */
async function pollRunEvents(
  runId: string,
  seen: Set<string>,
  onEvent: RunEventHandler,
  isClosed: () => boolean
): Promise<void> {
  for (let i = 0; i < MAX_POLLS && !isClosed(); i++) {
    const detail = await get<RunDetailResponse>(`/api/runs/${runId}`);
    for (const row of detail.events ?? []) {
      const event = normalizeRunEvent(runId, row);
      const key = row.id ?? `${event.eventType}:${event.createdAt ?? seen.size}`;
      if (seen.has(key)) continue;
      seen.add(key);
      await onEvent(event);
      if (event.status && TERMINAL_STATUSES.has(event.status)) return;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

/**
 * Normalizes Yash's snake_case event row into Laurence's Slack event contract.
 *
 * @param runId Reflex run ID.
 * @param row Event row from the run detail API.
 * @returns Slack-compatible run event.
 * @sideEffects None.
 */
function normalizeRunEvent(runId: string, row: NonNullable<RunDetailResponse['events']>[number]): RunEvent {
  return {
    runId,
    eventType: row.eventType ?? row.event_type ?? 'run.event',
    status: row.status ?? undefined,
    title: row.title ?? 'Run updated',
    detail: row.detail,
    payload: row.payload,
    createdAt: row.createdAt ?? row.created_at,
  };
}
