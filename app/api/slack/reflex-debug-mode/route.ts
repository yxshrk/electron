// POST /api/slack/reflex-debug-mode — user is actively reproducing (shared-contracts §3).
// Slack can't capture screen/mic, so we return an Open Recorder link to the browser recorder;
// after capture, Yash stores the debug artifacts and drafts the same report (same confirm flow).

import { verifySlackRequest } from '../../../../lib/slack/verify';
import { recorderBlocks } from '../../../../lib/slack/blocks';
import { postMessage } from '../../../../lib/slack/client';
import { createRun } from '../../../../lib/slack/backend';
import { DEFAULT_REPO, DEFAULT_CONTEXT_WINDOW, type RunCreateInput } from '../../../../lib/slack/contracts';

export const runtime = 'nodejs';

export async function POST(req: Request): Promise<Response> {
  const rawBody = await req.text();
  if (!verifySlackRequest({
    signingSecret: process.env.SLACK_SIGNING_SECRET ?? '',
    signature: req.headers.get('x-slack-signature'),
    timestamp: req.headers.get('x-slack-request-timestamp'),
    rawBody,
  })) {
    return new Response('invalid signature', { status: 401 });
  }

  const form = new URLSearchParams(rawBody);
  const channelId = form.get('channel_id') ?? '';

  void run(channelId);

  return Response.json({ response_type: 'ephemeral', text: '🎥 Reflex (debug mode) — opening a recorder for you…' });
}

async function run(channelId: string): Promise<void> {
  const input: RunCreateInput = {
    source: 'slack',
    mode: 'debug',
    role: 'sales_csm',
    repoUrl: DEFAULT_REPO,
    slackChannelId: channelId,
    slackThreadTs: null,
    contextWindow: DEFAULT_CONTEXT_WINDOW,
  };

  const { runId, recordingUrl } = await createRun(input);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';
  const recorderUrl = recordingUrl ?? `${appUrl}/debug/${runId}`;

  await postMessage({ channel: channelId, text: 'Open the Reflex recorder', blocks: recorderBlocks(runId, recorderUrl) });
  // After the browser recorder finishes, Yash stores the capture and drafts the report; the
  // confirm flow + status thread are then identical to bug mode (handled via /events + interactions).
}
