// POST /api/slack/reflex-command  — Slack slash-command intake (Phase L1).
// Slack sends application/x-www-form-urlencoded and expects a 200 within 3s.

import { verifySlackRequest } from '../../../../lib/slack/verify';
import { parseReflexCommand } from '../../../../lib/slack/grammar';
import { intakeAckBlocks, briefBlocks } from '../../../../lib/slack/blocks';
import { postMessage } from '../../../../lib/slack/client';
import { intake, subscribe } from '../../../../lib/slack/backend';
import { getBrief } from '../../../../lib/slack/__mocks__/reflex-backend';
import type { IntakePayload } from '../../../../lib/slack/contracts';

export const runtime = 'nodejs';

export async function POST(req: Request): Promise<Response> {
  const rawBody = await req.text();

  if (
    !verifySlackRequest({
      signingSecret: process.env.SLACK_SIGNING_SECRET ?? '',
      signature: req.headers.get('x-slack-signature'),
      timestamp: req.headers.get('x-slack-request-timestamp'),
      rawBody,
    })
  ) {
    return new Response('invalid signature', { status: 401 });
  }

  const form = new URLSearchParams(rawBody);
  const text = form.get('text') ?? '';
  const channelId = form.get('channel_id') ?? '';
  const userId = form.get('user_id') ?? '';

  const parsed = parseReflexCommand(text);

  // Build C1 and create the session.
  const payload: IntakePayload = {
    source: 'slack',
    role: parsed.role,
    repoUrl: parsed.repoUrl,
    transcript: parsed.transcript,
    slackContext: { channelId, threadTs: '', userId },
  };

  // Do the slow-ish work without blocking the 3s ack: respond immediately, post in background.
  void handleIntake(payload, channelId);

  // Ephemeral ack the user sees instantly.
  return Response.json({
    response_type: 'ephemeral',
    text: `🟡 Reflex received your report (role: *${parsed.role}*). Posting an update in this channel…`,
  });
}

async function handleIntake(payload: IntakePayload, channelId: string): Promise<void> {
  const { sessionId } = await intake(payload);

  // Post the timeline card; its ts becomes the thread root we update as status changes.
  const root = await postMessage({
    channel: channelId,
    text: 'Reflex is on it',
    blocks: intakeAckBlocks(payload),
  });

  // When the brief is ready, drop the Confirm/Edit card into the thread.
  const unsub = subscribe(sessionId, async (ev) => {
    if (ev.type === 'brief.ready') {
      const brief = getBrief(sessionId);
      if (brief) {
        await postMessage({
          channel: root.channel,
          thread_ts: root.ts,
          text: 'Does this look right?',
          blocks: briefBlocks(brief),
        });
      }
      unsub();
    }
  });
}
