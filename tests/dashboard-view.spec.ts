import assert from 'node:assert/strict';
import test from 'node:test';
import { prettyJson, stageState, statusLabel, statusTone } from '../lib/dashboard/view';

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
