// Thin REST client for the Replicas API.
// Verified surface (2026-06-06, see STACK_RESEARCH.md §1):
//   base  https://api.tryreplicas.com
//   auth  Authorization: Bearer sk_replicas_...
//   ⚠️ X-Replicas-Api-Version: 2026-05-17 makes POST /v1/replica return immediately
//      (status "preparing"). Without it the call BLOCKS until the workspace is active —
//      which serialises fan-out. Always send it.

import type { Replica, ReplicaEvent, EventHandler } from './types.js';

const BASE = process.env.REPLICAS_BASE_URL ?? 'https://api.tryreplicas.com';
const API_VERSION = '2026-05-17';

export class ReplicasError extends Error {
  constructor(message: string, readonly status?: number, readonly body?: string) {
    super(message);
    this.name = 'ReplicasError';
  }
}

export class ReplicasClient {
  constructor(private readonly apiKey = process.env.REPLICAS_API_KEY ?? '') {
    if (!apiKey) {
      throw new ReplicasError(
        'REPLICAS_API_KEY is not set. Claim 3600 hackathon credits at ' +
          'tryreplicas.com/dashboard/insforge-hackathon (code: ainexus), then create an API key ' +
          'under Settings → API Keys.',
      );
    }
  }

  private headers(extra: Record<string, string> = {}) {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      'X-Replicas-Api-Version': API_VERSION,
      ...extra,
    };
  }

  /** Dispatch a coding agent. Repo + setup live in the Environment, not here. */
  async createReplica(body: {
    name: string; // ^\S+$ — no whitespace
    message: string; // the hypothesis-specific brief
    environment_id?: string;
    coding_agent?: 'claude' | 'codex';
    thinking_level?: 'low' | 'medium' | 'high' | 'max';
    lifecycle_policy?: 'default' | 'delete_when_done' | 'delete_after_inactivity';
    webhook_url?: string | { url: string; secret: string };
    size?: 'small' | 'large';
  }): Promise<Replica> {
    const res = await fetch(`${BASE}/v1/replica`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ coding_agent: 'claude', lifecycle_policy: 'delete_when_done', ...body }),
    });
    return this.json<Replica>(res, 'createReplica');
  }

  /** Poll a replica. `include=diffs` expands git_diff / pr_urls. NB: getting a *sleeping* replica wakes it. */
  async getReplica(id: string, include?: string): Promise<Replica> {
    const qs = include ? `?include=${encodeURIComponent(include)}` : '';
    const res = await fetch(`${BASE}/v1/replica/${id}${qs}`, { headers: this.headers() });
    return this.json<Replica>(res, 'getReplica');
  }

  /**
   * Stream lifecycle events over SSE. Resolves when `until(event)` returns true or the
   * stream closes. Watch for `repo.status.changed` (→ payload.repos[].prUrls) and
   * `chat.turn.completed`. 15s heartbeats keep the connection alive.
   */
  async streamEvents(
    id: string,
    onEvent: EventHandler,
    until: (e: ReplicaEvent) => boolean = () => false,
    signal?: AbortSignal,
  ): Promise<void> {
    const res = await fetch(`${BASE}/v1/replica/${id}/events`, {
      headers: this.headers({ Accept: 'text/event-stream' }),
      signal,
    });
    if (!res.ok || !res.body) throw new ReplicasError('streamEvents failed', res.status);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by a blank line.
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        const dataLine = frame.split('\n').find((l) => l.startsWith('data:'));
        if (!dataLine) continue;
        const raw = dataLine.slice(5).trim();
        if (!raw || raw === '[DONE]') continue;
        let event: ReplicaEvent;
        try {
          event = JSON.parse(raw);
        } catch {
          continue; // skip heartbeats / non-JSON keepalives
        }
        onEvent(event);
        if (until(event)) {
          await reader.cancel().catch(() => {});
          return;
        }
      }
    }
  }

  private async json<T>(res: Response, op: string): Promise<T> {
    const text = await res.text();
    if (!res.ok) throw new ReplicasError(`${op} → ${res.status}`, res.status, text);
    return JSON.parse(text) as T;
  }
}

/** Pull a PR URL out of any replica/event shape we've seen. */
export function extractPrUrl(source: Replica | ReplicaEvent): string | undefined {
  const anySrc = source as any;
  return (
    anySrc.pull_requests?.[0]?.url ??
    anySrc.repository_statuses?.find((r: any) => r.pr_urls?.length)?.pr_urls?.[0] ??
    anySrc.payload?.repos?.find((r: any) => r.prUrls?.length)?.prUrls?.[0]
  );
}
