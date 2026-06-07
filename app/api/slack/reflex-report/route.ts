// POST /api/slack/reflex-report — bug already exists in Slack context (shared-contracts §3).
// No typing required: defaults role=sales_csm, repo=DEFAULT_REPO, gather latest 100 msgs + 3 files.

import { verifySlackRequest } from '../../../../lib/slack/verify';
import { ackBlocks, reportBlocks, blocksForEvent, dispatchPromptBlocks } from '../../../../lib/slack/blocks';
import { postMessage, updateMessage } from '../../../../lib/slack/client';
import { gatherContext } from '../../../../lib/slack/context';
import { createRun, postContext, draftBugBrief, mirrorEventsUntilTerminal, getDiagnosis } from '../../../../lib/slack/backend';
import { DEFAULT_REPO, DEFAULT_CONTEXT_WINDOW, type RunCreateInput } from '../../../../lib/slack/contracts';
import { background } from '../../../../lib/slack/after';

export const runtime = 'nodejs';
export const maxDuration = 300; // keep the status poll alive on Vercel (Fluid Compute)

/**
 * Handles Slack `/reflex-report` commands and starts the chat-history report workflow.
 *
 * @param req Signed Slack slash-command request.
 * @returns Ephemeral acknowledgement for Slack.
 * @sideEffects Verifies Slack signature and queues context gathering plus event mirroring.
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
  const commandText = form.get('text') ?? '';

  background(run(channelId, commandText));

  return Response.json({ response_type: 'ephemeral', text: '🟡 Reflex (report) is gathering context…' });
}

/**
 * Creates the report run, drafts the confirmation card, and mirrors run events into Slack.
 *
 * @param channelId Slack channel ID where the command was invoked.
 * @param commandText Slash command text used as the seed report.
 * @returns Nothing after the run reaches a terminal status or the event mirror times out.
 * @sideEffects Creates a Reflex run, stores Slack context, posts the report card, and updates Slack.
 */
async function run(channelId: string, commandText: string): Promise<void> {
  const input: RunCreateInput = {
    source: 'slack',
    mode: 'bug',
    role: 'sales_csm',
    repoUrl: DEFAULT_REPO,
    commandText: commandText || undefined,
    slackChannelId: channelId,
    slackThreadTs: null,
    contextWindow: DEFAULT_CONTEXT_WINDOW,
  };

  const { runId } = await createRun(input);

  // Root status message — updated in place as the run advances.
  const root = await postMessage({ channel: channelId, text: 'Reflex (report)', blocks: ackBlocks('bug', input.repoUrl) });

  // Gather + store nearby context (best-effort; never block the draft on a bad fetch).
  let msgCount = 0, fileCount = 0;
  try {
    const ctx = await gatherContext(channelId, input.contextWindow);
    msgCount = ctx.messages.length;
    fileCount = ctx.attachments.length;
    await postContext(runId, ctx.messages);
    // attachments need upload to Storage before /media (storageUrl required) — TODO, see events route
  } catch { /* mock or missing scopes — proceed with the draft */ }

  // Draft + post the confirmable report into the thread.
  const draft = await draftBugBrief(runId);
  const contextLine = `Used /reflex-report, ${msgCount} channel messages, and ${fileCount} file${fileCount === 1 ? '' : 's'}`;
  await postMessage({ channel: root.channel, thread_ts: root.ts, text: 'Confirm the bug report', blocks: reportBlocks(draft, contextLine) });

  // Stream status into the root card; post the Gate-2 approval card on diagnosed; PR card on ship.
  let dispatchPrompted = false;
  await mirrorEventsUntilTerminal(runId, async (ev) => {
    await updateMessage({ channel: root.channel, ts: root.ts, text: ev.title, blocks: blocksForEvent(ev) });
    if (ev.status === 'diagnosed' && !dispatchPrompted) {
      dispatchPrompted = true;
      const diag = await getDiagnosis(runId).catch(() => ({ hypotheses: [] }));
      await postMessage({ channel: root.channel, thread_ts: root.ts, text: 'Diagnosis ready — approve the fix?', blocks: dispatchPromptBlocks(runId, diag) });
    }
    if (ev.status === 'shipped') {
      const prUrl = ev.url ?? (ev.payload?.prUrl as string | undefined);
      if (prUrl) await postMessage({ channel: root.channel, thread_ts: root.ts, text: 'PR opened', blocks: blocksForEvent(ev) });
    }
  });
}
