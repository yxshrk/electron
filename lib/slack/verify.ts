// Slack request signature verification (https://api.slack.com/authentication/verifying-requests-from-slack).
// Every Slack route MUST call this on the RAW body before doing anything else.

import { createHmac, timingSafeEqual } from 'node:crypto';

const FIVE_MINUTES = 60 * 5;

export interface VerifyInput {
  signingSecret: string;
  /** X-Slack-Signature header, e.g. "v0=abc..." */
  signature: string | null;
  /** X-Slack-Request-Timestamp header (unix seconds). */
  timestamp: string | null;
  /** The exact raw request body string (NOT re-serialized JSON). */
  rawBody: string;
  /** Override for tests; defaults to now. */
  nowSeconds?: number;
}

/** Returns true iff the request genuinely came from Slack and isn't a replay. */
export function verifySlackRequest({
  signingSecret,
  signature,
  timestamp,
  rawBody,
  nowSeconds = Math.floor(Date.now() / 1000),
}: VerifyInput): boolean {
  if (!signature || !timestamp) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  // Reject replays / stale requests.
  if (Math.abs(nowSeconds - ts) > FIVE_MINUTES) return false;

  const base = `v0:${timestamp}:${rawBody}`;
  const expected = `v0=${createHmac('sha256', signingSecret).update(base).digest('hex')}`;

  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
