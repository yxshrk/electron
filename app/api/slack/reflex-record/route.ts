// POST /api/slack/reflex-record — user is actively reproducing (shared-contracts §3).
// Slack can't capture screen/mic → return an Open Recorder link to Yash's browser recorder
// (/debug/{runId}). The recorder owns capture → draft; Slack confirm starts diagnose + dispatch.
// job here is just to mirror the run status into the thread (Yash PR #8 wiring note).

import { verifySlackRequest } from '../../../../lib/slack/verify';
import { recorderBlocks, blocksForEvent } from '../../../../lib/slack/blocks';
import { postMessage, updateMessage } from '../../../../lib/slack/client';
import { createRun, mirrorEventsUntilTerminal, persistSlackThread } from '../../../../lib/slack/backend';
import { DEFAULT_REPO, DEFAULT_CONTEXT_WINDOW, type RunCreateInput } from '../../../../lib/slack/contracts';
import { background } from '../../../../lib/slack/after';

export const runtime = 'nodejs';
export const maxDuration = 300; // keep the status poll alive on Vercel (Fluid Compute)

/**
 * Handles Slack `/reflex-record` commands and starts the recorder workflow.
 *
 * @param req Signed Slack slash-command request.
 * @returns Ephemeral acknowledgement for Slack.
 * @sideEffects Verifies Slack signature and queues run creation plus event mirroring.
 */
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
  const userId = form.get('user_id') ?? undefined;

  background(run(channelId, userId));

  return Response.json({ response_type: 'ephemeral', text: '🎥 Reflex (record) — opening a recorder for you…' });
}

/**
 * Creates the recording run and mirrors run events into its Slack thread.
 *
 * @param channelId Slack channel ID where the command was invoked.
 * @param userId Slack user ID that started the command.
 * @returns Nothing after the run reaches a terminal status or the event mirror times out.
 * @sideEffects Creates a Reflex run, posts a recorder card, and posts/updates Slack thread messages.
 */
async function run(channelId: string, userId?: string): Promise<void> {
  const input: RunCreateInput = {
    source: 'slack',
    mode: 'debug',
    role: 'sales_csm',
    repoUrl: DEFAULT_REPO,
    slackChannelId: channelId,
    slackThreadTs: null,
    slackUserId: userId,
    contextWindow: DEFAULT_CONTEXT_WINDOW,
  };

  const { runId, recordingUrl } = await createRun(input);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';
  // Use the recordingUrl Yash returns; falls back to our origin (⚠️ localhost until deployed).
  const recorderUrl = recordingUrl ?? `${appUrl}/debug/${runId}`;

  const root = await postMessage({ channel: channelId, text: 'Open the Reflex recorder', blocks: recorderBlocks(runId, recorderUrl) });

  // Persist the thread root so the backend can push the Confirm / Approve-&-dispatch / PR cards
  // straight into this thread from setStatus (lib/slack/push) — those survive even if the mirror
  // poll below dies (Next dev teardown) or times out before the agent ships its PR.
  await persistSlackThread(runId, root.channel, root.ts).catch(() => { /* push falls back to a channel post */ });

  // Animate the live timeline only. The actionable cards are server-pushed (see above); keeping
  // them out of this poll means a dead/timed-out poll can no longer drop them.
  let timelineTs: string | undefined;
  await mirrorEventsUntilTerminal(runId, async (ev) => {
    if (!timelineTs) {
      const m = await postMessage({ channel: root.channel, thread_ts: root.ts, text: ev.title, blocks: blocksForEvent(ev) });
      timelineTs = m.ts;
    } else {
      await updateMessage({ channel: root.channel, ts: timelineTs, text: ev.title, blocks: blocksForEvent(ev) });
    }
  });
}
