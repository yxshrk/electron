import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runScriptedFallback } from '../agent/replicas/scripted-fallback';
import type { DispatchInput } from '../agent/replicas/types';

const input = JSON.parse(readFileSync('agent/examples/dispatch-input.json', 'utf8')) as DispatchInput;

test('scripted fallback dry-run returns evidence without creating a PR', () => {
  const result = runScriptedFallback(input);

  assert.equal(result.dryRun, true);
  assert.equal(result.evidence.provider, 'scripted');
  assert.equal(result.evidence.status, 'fixed');
  assert.equal(result.branchName, 'reflex/run_export_hang_01/unbounded_report_query');
  assert.match(result.prBody, /## Reflex Fix/);
});
