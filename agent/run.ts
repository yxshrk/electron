import { readFileSync } from 'node:fs';
import { buildReplicasPrompt } from './replicas/prompt';
import { dispatchConfirmedHypothesis } from './replicas/dispatch';
import { runScriptedFallback } from './replicas/scripted-fallback';
import type { DispatchInput } from './replicas/types';

/**
 * Runs the Reflex agent CLI.
 *
 * @param argv CLI arguments after the executable name.
 * @returns Process exit code.
 * @sideEffects Reads dispatch input files and writes JSON/prompt output.
 */
export async function runCli(argv: string[]): Promise<number> {
  const [command, inputPath = 'agent/examples/dispatch-input.json', ...flags] = argv;
  const input = readDispatchInput(inputPath);

  if (command === 'prompt') {
    console.log(buildReplicasPrompt(input));
    return 0;
  }

  if (command === 'dispatch') {
    const result = await dispatchConfirmedHypothesis(input, {
      createPr: flags.includes('--create-pr'),
      preferScriptedFallback: flags.includes('--scripted')
    });
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }

  if (command === 'scripted-fallback') {
    const result = runScriptedFallback(input, { createPr: flags.includes('--create-pr') });
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }

  console.error('Usage: tsx agent/run.ts <prompt|dispatch|scripted-fallback> [dispatch-input.json]');
  return 1;
}

/**
 * Reads and parses a dispatch input JSON file.
 *
 * @param inputPath File path to the dispatch input.
 * @returns Parsed dispatch input.
 * @sideEffects Reads from the filesystem.
 */
function readDispatchInput(inputPath: string): DispatchInput {
  return JSON.parse(readFileSync(inputPath, 'utf8')) as DispatchInput;
}

runCli(process.argv.slice(2)).then((exitCode) => {
  process.exitCode = exitCode;
});
