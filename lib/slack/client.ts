// Thin Slack Web API client (fetch-based, no SDK dependency). Only the calls Reflex needs.
// Token: SLACK_BOT_TOKEN (xoxb-...).

const SLACK_API = 'https://slack.com/api';

function token(): string {
  const t = process.env.SLACK_BOT_TOKEN;
  if (!t) throw new Error('SLACK_BOT_TOKEN is not set');
  return t;
}

async function call<T = any>(method: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${SLACK_API}/${method}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { ok: boolean; error?: string } & T;
  if (!json.ok) throw new Error(`slack ${method} failed: ${json.error}`);
  return json;
}

/** Post a message to a channel/thread. Returns the new message ts (stash it to update later). */
export async function postMessage(opts: {
  channel: string;
  blocks: unknown[];
  text: string; // fallback/notification text
  thread_ts?: string;
}): Promise<{ ts: string; channel: string }> {
  const r = await call<{ ts: string; channel: string }>('chat.postMessage', opts);
  return { ts: r.ts, channel: r.channel };
}

/** Update a previously-posted message in place (the timeline card). */
export async function updateMessage(opts: {
  channel: string;
  ts: string;
  blocks: unknown[];
  text: string;
}): Promise<void> {
  await call('chat.update', opts);
}

/** Open a modal in response to an interaction trigger_id (the Edit flow). */
export async function openModal(trigger_id: string, view: unknown): Promise<void> {
  await call('views.open', { trigger_id, view });
}

/** Get a file's metadata incl. the private download URL (url_private_download). */
export async function fileInfo(file: string): Promise<{ url_private_download: string; mimetype: string; name: string }> {
  const r = await call<{ file: { url_private_download: string; mimetype: string; name: string } }>('files.info', { file });
  return r.file;
}

export interface SlackMessage {
  ts: string;
  user?: string;
  text?: string;
  files?: Array<{ id: string; name: string; mimetype: string; url_private?: string }>;
}

/** Fetch recent channel messages (newest first) — used to gather bug-mode context. */
export async function conversationsHistory(channel: string, limit = 100): Promise<SlackMessage[]> {
  const r = await call<{ messages: SlackMessage[] }>('conversations.history', { channel, limit });
  return r.messages ?? [];
}

/** Download a Slack file's bytes (auth header required for private files). */
export async function downloadFile(urlPrivateDownload: string): Promise<ArrayBuffer> {
  const res = await fetch(urlPrivateDownload, { headers: { Authorization: `Bearer ${token()}` } });
  if (!res.ok) throw new Error(`file download failed: ${res.status}`);
  return res.arrayBuffer();
}
