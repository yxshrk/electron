import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runScriptedFallback, runScriptedFallbackViaGitHub } from '../agent/replicas/scripted-fallback';
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

test('scripted fallback can create a PR through GitHub API', async (t) => {
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  const originalFetch = globalThis.fetch;
  const brokenSource = 'export function exportReportCsv(records, options) { return exportReportCsvUnbounded(records, options); }';

  globalThis.fetch = (async (url, init) => {
    calls.push({
      url: String(url),
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? init.body : undefined,
    });

    if (String(url).endsWith('/git/ref/heads/main')) {
      return jsonResponse({ object: { sha: 'base-sha' } });
    }
    if (String(url).includes('/contents/app/test-fixtures/reports/export.ts')) {
      return jsonResponse({
        sha: 'file-sha',
        encoding: 'base64',
        content: Buffer.from(brokenSource, 'utf8').toString('base64'),
      });
    }
    if (String(url).endsWith('/git/refs') && init?.method === 'POST') {
      return jsonResponse({ ref: 'refs/heads/reflex/run_export_hang_01/unbounded_report_query' });
    }
    if (String(url).endsWith('/contents/app/test-fixtures/reports/export.ts') && init?.method === 'PUT') {
      return jsonResponse({ content: { sha: 'updated-file-sha' } });
    }
    if (String(url).endsWith('/pulls') && init?.method === 'POST') {
      return jsonResponse({ html_url: 'https://github.com/yxshrk/electron/pull/123' });
    }

    return jsonResponse({ message: 'not found' }, 404);
  }) as typeof fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await runScriptedFallbackViaGitHub(input, {
    apiBaseUrl: 'https://api.github.test',
    baseBranch: 'main',
    token: 'github-test-token',
  });

  assert.equal(result.dryRun, false);
  assert.equal(result.evidence.status, 'shipped');
  assert.equal(result.evidence.prUrl, 'https://github.com/yxshrk/electron/pull/123');

  const updateCall = calls.find((call) => call.method === 'PUT');
  assert.ok(updateCall?.body);
  const updateBody = JSON.parse(updateCall.body) as { content: string };
  const updatedSource = Buffer.from(updateBody.content, 'base64').toString('utf8');
  assert.match(updatedSource, /exportReportCsvBatched/);
  assert.doesNotMatch(updatedSource, /return exportReportCsvUnbounded/);
});

/**
 * Builds a JSON response for mocked fetch calls.
 *
 * @param body Serializable response body.
 * @param status HTTP status code.
 * @returns Fetch-compatible JSON response.
 * @sideEffects None.
 */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
