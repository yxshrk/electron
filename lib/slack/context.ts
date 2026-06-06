// Gather nearby Slack context for /reflex-report: the latest N channel messages as raw
// candidates + the latest few attachments. No LLM "+10 more" loop for the MVP (shared-contracts §3).

import { conversationsHistory } from './client';
import type { SlackContextCandidate, SlackMediaCandidate } from './contracts';

export interface GatheredContext {
  messages: SlackContextCandidate[];
  media: SlackMediaCandidate[];
}

function classifyKind(mimetype: string): SlackMediaCandidate['kind'] {
  if (mimetype.startsWith('image/')) return 'screenshot';
  if (mimetype.startsWith('video/') || mimetype.startsWith('audio/')) return 'recording';
  return 'file';
}

/**
 * Pull the latest `messageLimit` messages from a channel and the latest `attachmentLimit`
 * attachments across them. Trims total message text to `maxPromptChars` (newest kept first).
 */
export async function gatherContext(
  channelId: string,
  opts: { messageLimit: number; attachments: number; maxPromptChars: number },
): Promise<GatheredContext> {
  const raw = await conversationsHistory(channelId, opts.messageLimit);

  const messages: SlackContextCandidate[] = [];
  let budget = opts.maxPromptChars;
  for (const m of raw) {
    const text = (m.text ?? '').trim();
    if (!text) continue;
    if (budget - text.length < 0) break; // keep newest-first within the char budget
    budget -= text.length;
    messages.push({ ts: m.ts, userId: m.user, text });
  }

  const media: SlackMediaCandidate[] = [];
  for (const m of raw) {
    for (const f of m.files ?? []) {
      if (media.length >= opts.attachments) break;
      media.push({
        fileId: f.id,
        name: f.name,
        mimetype: f.mimetype,
        kind: classifyKind(f.mimetype),
        urlPrivate: f.url_private,
      });
    }
    if (media.length >= opts.attachments) break;
  }

  return { messages, media };
}
