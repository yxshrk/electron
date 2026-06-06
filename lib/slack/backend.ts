// Client for Yash's run APIs (InsForge-backed). Behind a mock toggle so the Slack surface is
// buildable/testable before /api/runs exists. REFLEX_BACKEND=mock (default in dev) → in-memory.

import type {
  ConfirmInput, DraftConfig, MediaArtifactInput, ReportDraft,
  RunCreateInput, RunCreateResponse, RunEvent, SlackAttachment, SlackContextCandidate,
} from './contracts';
import * as mock from './mock-backend';

const DEFAULT_DRAFT_CONFIG: DraftConfig = {
  includeSlackHistory: true, messageLimit: 100, includeAttachments: true,
  attachmentLimit: 3, includeDebugCapture: true, maxPromptChars: 6000,
};

const useMock = (process.env.REFLEX_BACKEND ?? 'mock') === 'mock';
const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} → ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

/** C1: create a run from a slash command. */
export function createRun(input: RunCreateInput): Promise<RunCreateResponse> {
  return useMock ? mock.createRun(input) : post('/api/runs', input);
}

/** Store copied Slack context candidates (§8: { messages, attachments }). */
export function postContext(runId: string, messages: SlackContextCandidate[], attachments: SlackAttachment[]): Promise<{ ok: true }> {
  return useMock ? mock.postContext(runId, messages, attachments) : post(`/api/runs/${runId}/context`, { messages, attachments });
}

/** Store one media artifact's metadata after upload to Storage (§8: one file per call). */
export function postMedia(runId: string, media: MediaArtifactInput): Promise<{ mediaArtifactId: string }> {
  return useMock ? mock.postMedia(runId, media) : post(`/api/runs/${runId}/media`, media);
}

/** Ask Yash to draft the confirmable report (§8: config body). */
export function draftBugBrief(runId: string, config: DraftConfig = DEFAULT_DRAFT_CONFIG): Promise<ReportDraft> {
  return useMock ? mock.draftBugBrief(runId) : post(`/api/runs/${runId}/draft-bug-brief`, config);
}

/** User confirmed (optionally with edits) → Yash creates the intake package + advances status. */
export function confirmBugBrief(runId: string, input: ConfirmInput = {}): Promise<{ ok: true }> {
  return useMock ? mock.confirmBugBrief(runId, input) : post(`/api/runs/${runId}/confirm-bug-brief`, input);
}

/** Subscribe to the run event stream. Returns an unsubscribe fn. */
export function subscribe(runId: string, onEvent: (e: RunEvent) => void): () => void {
  if (useMock) return mock.subscribe(runId, onEvent);
  const es = new EventSource(`${baseUrl}/api/runs/${runId}/events`);
  es.onmessage = (m) => onEvent(JSON.parse(m.data));
  return () => es.close();
}

export const isMock = useMock;
