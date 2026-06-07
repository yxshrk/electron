import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const recordRoute = readFileSync('app/api/slack/reflex-record/route.ts', 'utf8');
const reportRoute = readFileSync('app/api/slack/reflex-report/route.ts', 'utf8');
const backend = readFileSync('lib/slack/backend.ts', 'utf8');

test('Slack record/report routes await event mirroring for Vercel background tasks', () => {
  for (const source of [recordRoute, reportRoute]) {
    assert.match(source, /mirrorEventsUntilTerminal/);
    assert.doesNotMatch(source, /subscribe\(runId/);
  }
});

test('Slack backend exposes an awaitable terminal event mirror', () => {
  assert.match(backend, /export function mirrorEventsUntilTerminal/);
  assert.match(backend, /return pollRunEvents\(runId, new Set<string>\(\), onEvent, \(\) => false\)/);
  assert.match(backend, /await onEvent\(event\)/);
});
