// Client for Yash's run APIs (InsForge-backed). Behind a mock toggle so the Slack surface is
// buildable/testable before /api/runs exists. REFLEX_BACKEND=mock (default in dev) → in-memory.

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

/** Store copied Slack context candidates. Yash's /context takes { messages } only (PR #8). */
export function postContext(runId: string, messages: SlackContextCandidate[]): Promise<{ ok: true }> {
  return useMock ? mock.postContext(runId, messages) : post(`/api/runs/${runId}/context`, { messages });
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

/** Subscribe to the run event stream. Returns an unsubscribe fn.
 *  Yash's /events emits SSE named events: `run-event` (+ `done`/`error`) — PR #8.
 *  NOTE: this runs server-side (Node), where EventSource doesn't exist — consume the SSE with
 *  fetch + a ReadableStream reader instead. */
export function subscribe(runId: string, onEvent: (e: RunEvent) => void): () => void {
  if (useMock) return mock.subscribe(runId, onEvent);

  const ac = new AbortController();
  (async () => {
    try {
      const res = await fetch(`${baseUrl}/api/runs/${runId}/events`, {
        headers: { Accept: 'text/event-stream' },
        signal: ac.signal,
      });
      if (!res.ok || !res.body) return;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const frames = buf.split('\n\n');
        buf = frames.pop() ?? '';
        for (const frame of frames) {
          const lines = frame.split('\n');
          const evType = lines.find((l) => l.startsWith('event:'))?.slice(6).trim();
          const dataLine = lines.find((l) => l.startsWith('data:'))?.slice(5).trim();
          if (evType === 'done') { ac.abort(); return; }
          if (!dataLine || evType === 'error') continue;
          try { onEvent(JSON.parse(dataLine)); } catch { /* skip non-JSON keepalives */ }
        }
      }
    } catch { /* aborted or stream ended */ }
  })();

  return () => ac.abort();
}

export const isMock = useMock;
