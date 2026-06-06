// CLI runner for the agent-dispatch path — lets us exercise the contract end-to-end
// without the Next.js app. Reads a DispatchInput JSON from a file or stdin.
//
//   tsx agent/run.ts examples/dispatch-input.json          # live Replicas path
//   tsx agent/run.ts examples/dispatch-input.json --dry    # no live agent, prints plan
//
// Env: REPLICAS_API_KEY (live path). See agent/.env.example.

import { readFileSync } from 'node:fs';
import { dispatchHypothesis } from './replicas/dispatch.js';
import type { DispatchInput } from './replicas/types.js';

async function main() {
  const [, , file, ...flags] = process.argv;
  if (!file) {
    console.error('usage: tsx agent/run.ts <dispatch-input.json> [--dry]');
    process.exit(1);
  }

  const input = JSON.parse(readFileSync(file, 'utf8')) as DispatchInput;
  const dry = flags.includes('--dry');

  console.error(`▶ dispatching hypothesis "${input.hypothesis.title}" for session ${input.sessionId}`);

  if (dry) {
    const { buildBrief } = await import('./replicas/dispatch.js');
    console.error('— DRY RUN: brief that would be sent to the Replicas agent —\n');
    console.error(buildBrief(input));
    return;
  }

  const evidence = await dispatchHypothesis(input, {
    onEvent: (e) => console.error(`  · ${e.type}`),
  });

  // The evidence payload is the only thing on stdout — pipe it straight to Luke's /api/dispatch.
  console.log(JSON.stringify(evidence, null, 2));
  console.error(`\n✓ status: ${evidence.status}${evidence.prUrl ? ` · PR: ${evidence.prUrl}` : ''}`);
}

main().catch((err) => {
  console.error('✗ dispatch failed:', err.message);
  process.exit(1);
});
