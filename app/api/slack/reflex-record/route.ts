// POST /api/slack/reflex-record — user is actively reproducing (shared-contracts §3).
// Slack can't capture screen/mic → return an Open Recorder link to Yash's browser recorder
// (/debug/{runId}). The recorder owns capture → draft; Slack confirm starts diagnose + dispatch.
// job here is just to mirror the run status into the thread (Yash PR #8 wiring note).

import { verifySlackRequest } from '../../../../lib/slack/verify';
import { recorderBlocks, blocksForEvent, dispatchPromptBlocks, reportBlocks } from '../../../../lib/slack/blocks';
import { postMessage, updateMessage } from '../../../../lib/slack/client';
import { createRun, subscribe, getDiagnosis, getDraft } from '../../../../lib/slack/backend';
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

  return Response.json({ response_type: 'ephemeral', text: '🎥 Reflex (record) — opening a recorder for you…' });
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
  // Use the recordingUrl Yash returns; falls back to our origin (⚠️ localhost until deployed).
  const recorderUrl = recordingUrl ?? `${appUrl}/debug/${runId}`;

  const root = await postMessage({ channel: channelId, text: 'Open the Reflex recorder', blocks: recorderBlocks(runId, recorderUrl) });

  // Mirror the recorder-driven pipeline into the thread. The recorder page owns capture → draft;
  // Slack confirm starts diagnose + dispatch. Here we just render status from Yash's /events (SSE). Yash persists our
  // channel/thread, so a deploy could also push these — for now we subscribe in-process.
  let timelineTs: string | undefined;
  let reportPrompted = false;
  let dispatchPrompted = false;
  const unsub = subscribe(runId, async (ev) => {
    if (!timelineTs) {
      const m = await postMessage({ channel: root.channel, thread_ts: root.ts, text: ev.title, blocks: blocksForEvent(ev) });
      timelineTs = m.ts;
    } else {
      await updateMessage({ channel: root.channel, ts: timelineTs, text: ev.title, blocks: blocksForEvent(ev) });
    }
    // Gate 1: the recorder is capture-only — it drafts the report, then sends the user here to
    // confirm. Post the same Confirm/Edit card the report flow uses so there's something to click
    // (the recorder's "confirm in your Slack thread" instruction would otherwise be a dead end).
    if (ev.status === 'report_drafted' && !reportPrompted) {
      reportPrompted = true;
      const draft = await getDraft(runId).catch(() => undefined);
      if (draft) await postMessage({ channel: root.channel, thread_ts: root.ts, text: 'Confirm the bug report', blocks: reportBlocks(draft, 'Captured live via the Reflex recorder') });
    }
    if (ev.status === 'diagnosed' && !dispatchPrompted) {
      dispatchPrompted = true;
      const diag = await getDiagnosis(runId).catch(() => ({ hypotheses: [] }));
      await postMessage({ channel: root.channel, thread_ts: root.ts, text: 'Diagnosis ready — approve the fix?', blocks: dispatchPromptBlocks(runId, diag) });
    }
    if (ev.status === 'shipped') {
      const prUrl = ev.url ?? (ev.payload?.prUrl as string | undefined);
      if (prUrl) await postMessage({ channel: root.channel, thread_ts: root.ts, text: 'PR opened', blocks: blocksForEvent(ev) });
      unsub();
    }
  });
}
