import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { buildPullRequestBody, buildReplicasPrompt, buildReplicasTaskName } from '../agent/replicas/prompt';
import type { DispatchInput, EvidencePayload } from '../agent/replicas/types';

const input = JSON.parse(readFileSync('agent/examples/dispatch-input.json', 'utf8')) as DispatchInput;

test('Replicas prompt includes confirmed package and reproduction plan', () => {
  const prompt = buildReplicasPrompt(input);

  assert.match(prompt, /run_export_hang_01/);
  assert.match(prompt, /pkg_run_export_hang_01/);
  assert.match(prompt, /Seed a large dataset/);
  assert.match(prompt, /First reproduce the bug before changing code/);
});

test('Replicas task name is stable for callback correlation', () => {
  assert.equal(
    buildReplicasTaskName(input),
    'replicas_run_export_hang_01_unbounded_report_query'
  );
});

test('PR body includes source run, root cause, fix, and verification', () => {
  const evidence: EvidencePayload = {
    runId: input.runId,
    hypothesisId: input.hypothesis.id,
    status: 'shipped',
    rootCause: 'Report export uses the unbounded synchronous path.',
    fixSummary: 'Use batched export.',
    verification: 'Large export fixture passes.',
    provider: 'scripted',
    prUrl: 'https://github.com/yxshrk/electron/pull/123'
  };

  const body = buildPullRequestBody(
    input,
    evidence,
    'npm run test:export-large:repro',
    'npm run test:export-large:fixed'
  );

  assert.match(body, /Source run: run_export_hang_01/);
  assert.match(body, /Report export uses the unbounded synchronous path/);
  assert.match(body, /Use batched export/);
  assert.match(body, /Large export fixture passes/);
});
