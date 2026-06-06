import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

test('scripted fallback returns fixed evidence when the seeded bug is already fixed', () => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'reflex-fixed-repo-'));
  const fixtureDir = join(repoRoot, 'app/test-fixtures/reports');
  mkdirSync(fixtureDir, { recursive: true });
  writeFileSync(
    join(fixtureDir, 'export.ts'),
    'export function exportReportCsv(records, options) { return exportReportCsvBatched(records, options); }'
  );

  const result = runScriptedFallback(input, { createPr: true, repoRoot });

  assert.equal(result.dryRun, true);
  assert.equal(result.evidence.provider, 'scripted');
  assert.equal(result.evidence.status, 'fixed');
  assert.equal(result.evidence.prUrl, undefined);
});
