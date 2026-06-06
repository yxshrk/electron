// Gather nearby Slack context for /reflex-report: the latest N channel messages as raw
// candidates + the latest few attachments. No LLM "+10 more" loop for the MVP (shared-contracts §3).
// Output shapes match TECHNICAL_DOCUMENT.md §8 POST /api/runs/{runId}/context.

import { conversationsHistory } from './client';
import type { SlackContextCandidate, SlackAttachment } from './contracts';

export interface GatheredContext {
  messages: SlackContextCandidate[];
  attachments: SlackAttachment[];
}

function classifyKind(mimetype: string): SlackAttachment['kind'] {
  if (mimetype.startsWith('image/')) return 'screenshot';
  if (mimetype.startsWith('video/')) return 'video';
  if (mimetype.startsWith('audio/')) return 'recording';
  return 'file';
}

/**
 * Pull the latest `messageLimit` messages from a channel and the latest `attachments` files
 * across them. Trims total message text to `maxPromptChars` (newest kept first).
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
    messages.push({
      slackMessageTs: m.ts,
      slackUserId: m.user,
      text,
      hasFiles: (m.files?.length ?? 0) > 0,
    });
  }

  const attachments: SlackAttachment[] = [];
  for (const m of raw) {
    for (const f of m.files ?? []) {
      if (attachments.length >= opts.attachments) break;
      attachments.push({
        slackFileId: f.id,
        slackMessageTs: m.ts,
        kind: classifyKind(f.mimetype),
        filename: f.name,
      });
    }
    if (attachments.length >= opts.attachments) break;
  }

  return { messages, attachments };
}
