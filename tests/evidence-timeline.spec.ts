import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEvidenceTimelineEvents } from '../lib/insforge/evidence';
import type { EvidencePayload } from '../lib/insforge/types';

const shippedEvidence: EvidencePayload = {
  runId: 'run_123',
  hypothesisId: 'hyp_123',
  status: 'shipped',
  rootCause: 'Default export uses the unbounded synchronous path.',
  fixSummary: 'Route default export through the batched exporter.',
  verification: 'Large export fixture completes under the demo timeout.',
  prUrl: 'https://github.com/yxshrk/electron/pull/42',
  provider: 'scripted',
};

test('shipped evidence creates reproduced, fixed, and PR-opened timeline events', () => {
  const events = buildEvidenceTimelineEvents(shippedEvidence, 'agent_123');

  assert.deepEqual(events.map((event) => event.status), ['reproduced', 'fixed', 'shipped']);
  assert.deepEqual(events.map((event) => event.event.eventType), [
    'bug.reproduced',
    'fix.verified',
    'pr.opened',
  ]);
  assert.equal(events[2].event.payload?.prUrl, shippedEvidence.prUrl);
  assert.equal(events[2].event.payload?.agentRunId, 'agent_123');
});

test('PR failure preserves reproduced and fixed milestones before failing', () => {
  const events = buildEvidenceTimelineEvents({ ...shippedEvidence, status: 'pr_failed', prUrl: undefined }, 'agent_123');

  assert.deepEqual(events.map((event) => event.status), ['reproduced', 'fixed', 'pr_failed']);
  assert.equal(events[2].event.eventType, 'pr.failed');
});
