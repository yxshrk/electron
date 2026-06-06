// Client for Yash's run APIs (InsForge-backed). Behind a mock toggle so the Slack surface is
// buildable/testable before /api/runs exists. REFLEX_BACKEND=mock (default in dev) → in-memory.

import type {
  ReportDraft, RunCreateInput, RunCreateResponse, RunEvent,
  SlackContextCandidate, SlackMediaCandidate,
} from './contracts';
import * as mock from './mock-backend';

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

/** Store copied Slack context candidates. */
export function postContext(runId: string, messages: SlackContextCandidate[], maxPromptChars: number): Promise<{ ok: true }> {
  return useMock ? mock.postContext(runId, messages) : post(`/api/runs/${runId}/context`, { messages, maxPromptChars });
}

/** Store Slack file metadata. */
export function postMedia(runId: string, media: SlackMediaCandidate[]): Promise<{ ok: true }> {
  return useMock ? mock.postMedia(runId, media) : post(`/api/runs/${runId}/media`, { media });
}

/** Ask Yash to draft the confirmable report. */
export function draftBugBrief(runId: string): Promise<ReportDraft> {
  return useMock ? mock.draftBugBrief(runId) : post(`/api/runs/${runId}/draft-bug-brief`, {});
}

/** User confirmed (optionally with edits) → Yash creates the intake package + advances status. */
export function confirmBugBrief(runId: string, edits?: Record<string, string>): Promise<{ ok: true }> {
  return useMock ? mock.confirmBugBrief(runId, edits) : post(`/api/runs/${runId}/confirm-bug-brief`, { edits });
}

/** Subscribe to the run event stream. Returns an unsubscribe fn. */
export function subscribe(runId: string, onEvent: (e: RunEvent) => void): () => void {
  if (useMock) return mock.subscribe(runId, onEvent);
  const es = new EventSource(`${baseUrl}/api/runs/${runId}/events`);
  es.onmessage = (m) => onEvent(JSON.parse(m.data));
  return () => es.close();
}

export const isMock = useMock;
