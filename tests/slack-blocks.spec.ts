import assert from 'node:assert/strict';
import test from 'node:test';
import { dispatchStartedBlocks } from '../lib/slack/blocks';

test('dispatch started card removes the approve dispatch button', () => {
  const encoded = JSON.stringify(dispatchStartedBlocks());

  assert.match(encoded, /Dispatch started/);
  assert.doesNotMatch(encoded, /reflex_dispatch/);
  assert.doesNotMatch(encoded, /Approve & dispatch fix/);
});
