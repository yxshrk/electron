// Standalone tests for the Slack slice — no Next.js needed. Run: npx tsx scripts/test-slack.ts
// Covers: grammar parsing, signature verify (valid + forged), block builders, and the full
// mock intake → brief → confirm → pr.opened event sequence.

import { createHmac } from 'node:crypto';
import { parseReflexCommand } from '../lib/slack/grammar.js';
import { verifySlackRequest } from '../lib/slack/verify.js';
import { intakeAckBlocks, briefBlocks, statusTimelineBlocks, blocksForEvent } from '../lib/slack/blocks.js';
import { intake, confirm, subscribe } from '../lib/slack/backend.js';
import { getBrief } from '../lib/slack/__mocks__/reflex-backend.js';
import type { StatusEvent } from '../lib/slack/contracts.js';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
}

console.log('\n# grammar');
{
  const a = parseReflexCommand('role:sales repo:https://github.com/acme/app export hangs on big reports');
  ok('parses role', a.role === 'sales');
  ok('parses repo url', a.repoUrl === 'https://github.com/acme/app');
  ok('captures transcript', a.transcript === 'export hangs on big reports');

  const b = parseReflexCommand('repo:acme/app the thing is slow');
  ok('owner/name → full url', b.repoUrl === 'https://github.com/acme/app');

  const c = parseReflexCommand('just plain text no tags');
  ok('defaults role to engineer', c.role === 'engineer');
  ok('defaults repo', c.repoUrl.includes('yxshrk/electron'));
  ok('warns on missing role/repo', c.warnings.length >= 2);

  const d = parseReflexCommand('role:wizard hi');
  ok('unknown role falls back + warns', d.role === 'engineer' && d.warnings.some(w => w.includes('unknown role')));
}

console.log('\n# signature verify');
{
  const secret = 'shhh';
  const ts = '1700000000';
  const rawBody = 'token=x&text=hello';
  const good = `v0=${createHmac('sha256', secret).update(`v0:${ts}:${rawBody}`).digest('hex')}`;
  ok('accepts valid signature', verifySlackRequest({ signingSecret: secret, signature: good, timestamp: ts, rawBody, nowSeconds: 1700000005 }));
  ok('rejects forged signature', !verifySlackRequest({ signingSecret: secret, signature: 'v0=deadbeef', timestamp: ts, rawBody, nowSeconds: 1700000005 }));
  ok('rejects stale timestamp (replay)', !verifySlackRequest({ signingSecret: secret, signature: good, timestamp: ts, rawBody, nowSeconds: 1700000000 + 99999 }));
  ok('rejects missing headers', !verifySlackRequest({ signingSecret: secret, signature: null, timestamp: null, rawBody }));
}

console.log('\n# block builders');
{
  const ack = intakeAckBlocks({ role: 'sales', repoUrl: 'https://github.com/acme/app', transcript: 'x' });
  ok('ack has header', (ack[0] as any).type === 'header');

  const timeline = statusTimelineBlocks('dispatched', 'detail');
  ok('timeline renders', JSON.stringify(timeline).includes('Agent dispatched'));

  const failTimeline = statusTimelineBlocks('reproduction_failed', 'no repro');
  ok('failure timeline shows snag', JSON.stringify(failTimeline).includes('snag'));

  const brief = briefBlocks({ sessionId: 's1', role: 'sales', symptom: 'hangs', evidence: ['e1'], hypotheses: [{ id: 'h1', title: 'unbounded query', confidence: 0.7 }], needsConfirmation: true });
  const briefStr = JSON.stringify(brief);
  ok('brief has confirm action', briefStr.includes('reflex_confirm'));
  ok('brief has edit action', briefStr.includes('reflex_edit'));
  ok('brief shows confidence %', briefStr.includes('70%'));

  const pr = blocksForEvent({ sessionId: 's1', type: 'pr.opened', status: 'shipped', prUrl: 'https://x/pull/1' });
  ok('pr event → PR card', JSON.stringify(pr).includes('/pull/1'));
}

console.log('\n# mock backend: intake → brief → confirm → ship');
await (async () => {
  const { sessionId, status } = await intake({ source: 'slack', role: 'sales', repoUrl: 'https://github.com/yxshrk/electron', transcript: 'export hangs' });
  ok('intake returns sessionId', sessionId.startsWith('sess_mock_'));
  ok('intake status created', status === 'created');

  const seen: StatusEvent[] = [];
  await new Promise<void>((resolve) => {
    subscribe(sessionId, (ev) => {
      seen.push(ev);
      if (ev.type === 'brief.ready') {
        ok('brief available at brief.ready', !!getBrief(sessionId));
        confirm(sessionId); // kick the dispatch→ship sequence
      }
      if (ev.type === 'pr.opened') resolve();
    });
    setTimeout(() => resolve(), 8000); // safety
  });

  const types = seen.map((e) => e.type);
  ok('saw diagnosis.created', types.includes('diagnosis.created'));
  ok('saw brief.ready', types.includes('brief.ready'));
  ok('saw session.confirmed', types.includes('session.confirmed'));
  ok('saw agent.reproduced', types.includes('agent.reproduced'));
  ok('ended on pr.opened with url', seen.at(-1)?.type === 'pr.opened' && !!seen.at(-1)?.prUrl);
})();

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
