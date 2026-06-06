// Standalone tests for the Slack slice — no Next.js/Slack needed. Run: npm run test:slack
// Covers: signature verify, block builders (ack/recorder/timeline/report/pr), and the full mock
// createRun → draft → confirm → shipped RunEvent sequence (docs/slack-bug-mode-mvp spec).

import { createHmac } from 'node:crypto';
import { verifySlackRequest } from '../lib/slack/verify';
import { ackBlocks, recorderBlocks, statusTimelineBlocks, reportBlocks, blocksForEvent, dispatchPromptBlocks } from '../lib/slack/blocks';
import { createRun, draftBugBrief, confirmBugBrief, subscribe, dispatch } from '../lib/slack/backend';
import { getDraft } from '../lib/slack/mock-backend';
import { DEFAULT_CONTEXT_WINDOW, type RunEvent } from '../lib/slack/contracts';
import { buildSlackObservation } from '../lib/slack/observation';
import { containsSecretLikeText, isSafeContextMessage } from '../lib/slack/context';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
}

console.log('\n# signature verify');
{
  const secret = 'shhh', ts = '1700000000', rawBody = 'token=x&text=hello';
  const good = `v0=${createHmac('sha256', secret).update(`v0:${ts}:${rawBody}`).digest('hex')}`;
  ok('accepts valid signature', verifySlackRequest({ signingSecret: secret, signature: good, timestamp: ts, rawBody, nowSeconds: 1700000005 }));
  ok('rejects forged signature', !verifySlackRequest({ signingSecret: secret, signature: 'v0=deadbeef', timestamp: ts, rawBody, nowSeconds: 1700000005 }));
  ok('rejects stale timestamp (replay)', !verifySlackRequest({ signingSecret: secret, signature: good, timestamp: ts, rawBody, nowSeconds: 1700099999 }));
  ok('rejects missing headers', !verifySlackRequest({ signingSecret: secret, signature: null, timestamp: null, rawBody }));
}

console.log('\n# block builders');
{
  ok('bug ack header', JSON.stringify(ackBlocks('bug', 'https://github.com/x/y')).includes('report'));
  ok('debug ack header', JSON.stringify(ackBlocks('debug', 'https://github.com/x/y')).includes('record'));
  ok('recorder has Open Recorder url button', JSON.stringify(recorderBlocks('run_1', 'https://app/debug/run_1')).includes('Open Recorder'));

  ok('timeline shows new stages', JSON.stringify(statusTimelineBlocks('dispatched')).includes('Agent dispatched'));
  ok('timeline knows package_confirmed', JSON.stringify(statusTimelineBlocks('package_confirmed')).includes('Confirmed by you'));
  ok('failure timeline shows snag', JSON.stringify(statusTimelineBlocks('reproduction_failed', 'no repro')).includes('snag'));

  const draft = getDraft('seed') ?? undefined;
  const report = reportBlocks({
    runId: 'r1', bugBriefId: 'b1', status: 'needs_confirmation',
    whereItHappens: 'Reports page', actualBehavior: 'hangs', expectedBehavior: 'completes',
    affectedSurface: 'backend', evidenceSummary: [{ kind: 'channel_message', summary: 'x' }],
    missingInfo: ['dataset size'], agentPromptPreview: 'reproduce then fix',
  }, 'Used /reflex-report, 8 channel messages, and 2 files');
  const r = JSON.stringify(report);
  ok('report has confirm action', r.includes('reflex_confirm'));
  ok('report has edit action', r.includes('reflex_edit'));
  ok('report has add-attachment action', r.includes('reflex_add_attachment'));
  ok('report shows affected surface', r.includes('backend'));
  ok('report shows agent prompt preview', r.includes('reproduce then fix'));
  ok('report shows context line', r.includes('8 channel messages'));
  void draft;

  const pr = blocksForEvent({ status: 'shipped', payload: { prUrl: 'https://x/pull/1' } });
  ok('shipped event → PR card', JSON.stringify(pr).includes('/pull/1'));

  const gate2 = JSON.stringify(dispatchPromptBlocks('r1', { symptom: 'export hangs', hypotheses: [{ title: 'unbounded query', confidence: 0.7 }] }));
  ok('dispatch card has approve button', gate2.includes('reflex_dispatch'));
  ok('dispatch card shows hypothesis', gate2.includes('unbounded query'));
}

console.log('\n# slack context observation');
{
  ok('filters bot-authored context', !isSafeContextMessage({ ts: '1', bot_id: 'B_REFLEX', text: 'Reflex (report)' }));
  ok('filters credential-looking context', containsSecretLikeText(['API', '_KEY=not-a-real-value'].join('')));
  ok('keeps user bug context', isSafeContextMessage({ ts: '2', user: 'U_CSM', text: 'Customer export hangs on large reports.' }));

  const observation = buildSlackObservation(
    { command_text: 'Customer says export hangs on large reports.' },
    [
      {
        ts: '1710000000.000100',
        userId: 'U_CSM',
        text: 'When export runs, frontend crashes and the spinner never resolves.',
        hasFiles: true,
      },
    ],
  );
  ok('normalizes export-hang symptom', observation.visibleState.symptomSeed === 'Report export hangs on large datasets');
  ok('keeps command in transcript', observation.transcript.includes('[command] Customer says export hangs'));
  ok('summarizes Slack file evidence', observation.visibleState.evidenceSummary.some((e) => e.kind === 'slack_message_with_file'));
}

console.log('\n# mock backend: two gates — confirm→diagnosed, then dispatch→shipped');
void (async () => {
  const { runId, status } = await createRun({
    source: 'slack', mode: 'bug', role: 'sales_csm', repoUrl: 'https://github.com/yxshrk/electron',
    slackChannelId: 'C1', slackThreadTs: null, contextWindow: DEFAULT_CONTEXT_WINDOW,
  });
  ok('createRun returns runId', runId.startsWith('run_mock_'));
  ok('createRun status created', status === 'created');

  const draft = await draftBugBrief(runId);
  ok('draft needs_confirmation', draft.status === 'needs_confirmation');
  ok('getDraft matches', getDraft(runId)?.runId === runId);

  const seen: RunEvent[] = [];
  const unsub = subscribe(runId, (ev) => { seen.push(ev); });

  // Gate 1: confirm → diagnosed, then STOP (no dispatch yet).
  await new Promise<void>((resolve) => {
    confirmBugBrief(runId);
    const t = setInterval(() => { if (seen.some((e) => e.status === 'diagnosed')) { clearInterval(t); resolve(); } }, 50);
    setTimeout(() => { clearInterval(t); resolve(); }, 5000);
  });
  ok('Gate 1: saw package_confirmed', seen.some((e) => e.status === 'package_confirmed'));
  ok('Gate 1: saw diagnosed', seen.some((e) => e.status === 'diagnosed'));
  ok('Gate 1: stops before dispatch (no shipped yet)', !seen.some((e) => e.status === 'shipped'));

  // Gate 2: dispatch → reproduced → shipped.
  await new Promise<void>((resolve) => {
    dispatch(runId, { createPr: false });
    const t = setInterval(() => { if (seen.some((e) => e.status === 'shipped')) { clearInterval(t); resolve(); } }, 50);
    setTimeout(() => { clearInterval(t); resolve(); }, 5000);
  });
  ok('Gate 2: saw dispatched', seen.some((e) => e.status === 'dispatched'));
  ok('Gate 2: saw reproduced', seen.some((e) => e.status === 'reproduced'));
  ok('Gate 2: ended shipped with prUrl', seen.at(-1)?.status === 'shipped' && !!(seen.at(-1)?.payload?.prUrl));
  unsub();

  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
