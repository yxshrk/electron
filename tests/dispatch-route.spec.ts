import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const dispatchRoute = readFileSync('app/api/runs/[runId]/dispatch/route.ts', 'utf8');

test('dispatch route calls the dispatcher directly instead of self-fetching dispatch-replicas', () => {
  assert.match(dispatchRoute, /dispatchConfirmedHypothesis/);
  assert.doesNotMatch(dispatchRoute, /fetch\([^)]*dispatch-replicas/);
});
