// Scripted in-memory backend so the Slack surface works end-to-end before Yash's /api/runs exists.
// Replays a realistic RunEvent sequence on a timer (shared-contracts §2 state machine).

import type {
  ConfirmInput, MediaArtifactInput, ReportDraft, RunCreateInput, RunCreateResponse,
  RunEvent, SlackContextCandidate,
} from './contracts';

interface MockRun {
  id: string;
  input: RunCreateInput;
  contextCount: number;
  mediaCount: number;
}

const runs = new Map<string, MockRun>();
let counter = 0;

function draftFor(runId: string): ReportDraft {
  const run = runs.get(runId);
  return {
    runId,
    bugBriefId: `brief_${runId}`,
    status: 'needs_confirmation',
    whereItHappens: 'Report export on the Reports page',
    actualBehavior: 'Exporting a large report hangs; the spinner never resolves.',
    expectedBehavior: 'The export completes and downloads within a few seconds.',
    affectedSurface: 'backend',
    evidenceSummary: [
      { kind: 'channel_message', summary: 'CSM: customer says big exports just hang' },
      ...(run && run.mediaCount > 0 ? [{ kind: 'screenshot', summary: 'Export spinner stuck' }] : []),
    ],
    missingInfo: ['Exact dataset size that triggers it', 'Browser / environment'],
    agentPromptPreview:
      'Reproduce: trigger a report export with a large dataset; confirm it hangs/times out; ' +
      'localize the query path; add pagination/streaming; verify it completes under the timeout.',
  };
}

export async function createRun(input: RunCreateInput): Promise<RunCreateResponse> {
  const id = `run_mock_${++counter}`;
  runs.set(id, { id, input, contextCount: 0, mediaCount: 0 });
  const recordingUrl = input.mode === 'debug' ? `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/debug/${id}` : undefined;
  return { runId: id, status: 'created', recordingUrl };
}

export async function postContext(runId: string, messages: SlackContextCandidate[]): Promise<{ ok: true }> {
  const r = runs.get(runId);
  if (r) r.contextCount = messages.length;
  return { ok: true };
}

export async function postMedia(runId: string, _media: MediaArtifactInput): Promise<{ mediaArtifactId: string }> {
  const r = runs.get(runId);
  if (r) r.mediaCount += 1;
  return { mediaArtifactId: `media_${runId}_${r?.mediaCount ?? 1}` };
}

export async function draftBugBrief(runId: string): Promise<ReportDraft> {
  return draftFor(runId);
}

export async function confirmBugBrief(runId: string, _input?: ConfirmInput): Promise<{ ok: true }> {
  emitSequence(runId);
  return { ok: true };
}

// --- event stream ---
const listeners = new Map<string, Set<(e: RunEvent) => void>>();

export function subscribe(runId: string, onEvent: (e: RunEvent) => void): () => void {
  const set = listeners.get(runId) ?? new Set();
  set.add(onEvent);
  listeners.set(runId, set);
  return () => set.delete(onEvent);
}

function emit(runId: string, partial: Omit<RunEvent, 'runId' | 'createdAt'>): void {
  const ev: RunEvent = { runId, createdAt: new Date().toISOString(), ...partial };
  listeners.get(runId)?.forEach((fn) => fn(ev));
}

function emitSequence(runId: string): void {
  const repo = runs.get(runId)?.input.repoUrl ?? 'https://github.com/yxshrk/electron';
  const steps: Array<[number, Omit<RunEvent, 'runId' | 'createdAt'>]> = [
    [150, { eventType: 'package.confirmed', status: 'package_confirmed', title: 'Confirmed', detail: 'You confirmed the report' }],
    [800, { eventType: 'diagnosis.created', status: 'diagnosed', title: 'Diagnosed', detail: 'Symptom + 3 hypotheses' }],
    [950, { eventType: 'dispatch.started', status: 'dispatched', title: 'Dispatched', detail: 'Top hypothesis → sandbox' }],
    [1400, { eventType: 'agent.reproduced', status: 'reproduced', title: 'Reproduced', detail: 'Export timed out at 30s on 10k rows' }],
    [2400, { eventType: 'agent.fixed', status: 'fixed', title: 'Fixed', detail: 'Added pagination; test passes' }],
    [3200, { eventType: 'pr.opened', status: 'shipped', title: 'PR opened', detail: 'Batch export + stream progress', url: `${repo}/pull/42`, payload: { prUrl: `${repo}/pull/42` } }],
  ];
  for (const [ms, partial] of steps) setTimeout(() => emit(runId, partial), ms);
}

/** Test helper. */
export function getDraft(runId: string): ReportDraft | undefined {
  return runs.has(runId) ? draftFor(runId) : undefined;
}
