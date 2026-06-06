// Gather nearby Slack context for /reflex-report: the latest N channel messages as raw
// candidates + the latest few attachments. No LLM "+10 more" loop for the MVP (shared-contracts §3).
// Output shapes match TECHNICAL_DOCUMENT.md §8 POST /api/runs/{runId}/context.

import { conversationsHistory } from './client';
import type { SlackMessage } from './client';
import type { SlackContextCandidate, SlackAttachment } from './contracts';

export interface GatheredContext {
  messages: SlackContextCandidate[];
  attachments: SlackAttachment[];
}

function classifyKind(mimetype: string): SlackAttachment['kind'] {
  if (mimetype.startsWith('image/')) return 'screenshot';
  if (mimetype.startsWith('video/')) return 'video';
  if (mimetype.startsWith('audio/')) return 'audio_recording';
  return 'other';
}

const REFLEX_BOT_TEXT = /^(reflex\b|🎥 reflex|⚡ reflex|🟡 reflex|open the reflex recorder|intake package confirmed|report confirmed)/i;
const SECRET_TEXT = /\b(?:SLACK_[A-Z_]*TOKEN|SLACK_SIGNING_SECRET|[A-Z0-9_]*(?:TOKEN|SECRET|API_KEY|ACCESS_KEY|PRIVATE_KEY))\s*=\s*\S+|xox[baprs]-[A-Za-z0-9-]+|uak_[A-Za-z0-9]+/i;

/**
 * Pull the latest `messageLimit` messages from a channel and the latest `attachments` files
 * across them. Trims total message text to `maxPromptChars` (newest kept first).
 *
 * @param channelId Slack channel ID to read.
 * @param opts Context limits for messages, attachments, and prompt characters.
 * @returns Safe user-authored Slack messages and attachment references.
 * @sideEffects Reads channel history through the Slack Web API.
 */
export async function gatherContext(
  channelId: string,
  opts: { messageLimit: number; attachments: number; maxPromptChars: number },
): Promise<GatheredContext> {
  const raw = await conversationsHistory(channelId, opts.messageLimit);
  const safe = raw.filter(isSafeContextMessage);

  const messages: SlackContextCandidate[] = [];
  let budget = opts.maxPromptChars;
  for (const m of safe) {
    const text = (m.text ?? '').trim();
    if (!text) continue;
    if (budget - text.length < 0) break; // keep newest-first within the char budget
    budget -= text.length;
    messages.push({
      ts: m.ts,
      userId: m.user,
      text,
      hasFiles: (m.files?.length ?? 0) > 0,
    });
  }

  const attachments: SlackAttachment[] = [];
  for (const m of safe) {
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

/**
 * Decides whether a Slack history item is safe and useful for bug-report context.
 *
 * @param message Raw Slack message from `conversations.history`.
 * @returns True for user-authored, non-secret-looking bug context.
 * @sideEffects None.
 */
export function isSafeContextMessage(message: SlackMessage): boolean {
  const text = (message.text ?? '').trim();
  if (!text) return false;
  if (message.bot_id || message.app_id || message.subtype === 'bot_message') return false;
  if (REFLEX_BOT_TEXT.test(text)) return false;
  return !containsSecretLikeText(text);
}

/**
 * Detects credential-looking text that must never be sent into bug-report context.
 *
 * @param text Slack message text.
 * @returns True when the text resembles a token, secret, or API key assignment.
 * @sideEffects None.
 */
export function containsSecretLikeText(text: string): boolean {
  return SECRET_TEXT.test(text);
}
