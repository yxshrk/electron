import assert from 'node:assert/strict';
import test from 'node:test';
import {
  actorLabel,
  evidenceLabel,
  evidenceTotalCount,
  prettyJson,
  stageState,
  statusLabel,
  statusTone,
} from '../lib/dashboard/view';

test('dashboard status helpers format pipeline states', () => {
  assert.equal(statusLabel('package_confirmed'), 'package confirmed');
  assert.equal(statusTone('diagnosed'), 'good');
  assert.equal(statusTone('running'), 'info');
  assert.equal(statusTone('dispatch_failed'), 'bad');
});

test('dashboard stage rail marks done, active, and pending stages', () => {
  assert.equal(stageState('diagnosed', 'created'), 'done');
  assert.equal(stageState('diagnosed', 'diagnosed'), 'active');
  assert.equal(stageState('diagnosed', 'shipped'), 'pending');
  assert.equal(stageState('diagnosis_failed', 'diagnosed'), 'failed');
});

test('dashboard JSON formatter is stable and readable', () => {
  assert.equal(prettyJson({ symptomSeed: 'Report export hangs' }), '{\n  "symptomSeed": "Report export hangs"\n}');
});

test('dashboard evidence helpers include recorder observations', () => {
  const run = { chat_message_count: 2, media_count: 1, observation_count: 3 };

  assert.equal(evidenceTotalCount(run), 6);
  assert.equal(evidenceLabel(run), '2 chat / 1 media / 3 debug');
});

test('dashboard actor label distinguishes Slack starters', () => {
  assert.equal(actorLabel('U123ABC'), 'Slack U123ABC');
  assert.equal(actorLabel('web'), 'web');
  assert.equal(actorLabel(null), 'unknown');
});
