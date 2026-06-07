import { createReplicasTask } from './client';
import { buildReplicasPrompt, buildReplicasTaskName, buildReplicasTaskTitle } from './prompt';
import { runScriptedFallback, runScriptedFallbackViaGitHub } from './scripted-fallback';
import type { DispatchInput, DispatchResult, ScriptedFallbackRun } from './types';

export interface DispatchOptions {
  createPr?: boolean;
  preferScriptedFallback?: boolean;
}

/**
 * Dispatches a confirmed hypothesis to Replicas, or to the scripted fallback when live credentials are absent.
 *
 * @param input Confirmed dispatch input from diagnosis.
 * @param options Dispatch behavior controls.
 * @returns Dispatch result with Replicas task metadata or scripted evidence.
 * @sideEffects May perform a Replicas API request or run scripted fallback actions.
 */
export async function dispatchConfirmedHypothesis(
  input: DispatchInput,
  options: DispatchOptions = {}
): Promise<DispatchResult> {
  const prompt = buildReplicasPrompt(input);
  const taskName = buildReplicasTaskName(input);
  const taskTitle = buildReplicasTaskTitle(input);

  if (options.preferScriptedFallback || !process.env.REPLICAS_API_KEY) {
    const fallback = await runScriptedFallbackForRuntime(input, options);

    return {
      provider: 'scripted',
      status: fallback.evidence.status,
      taskName,
      taskTitle,
      prompt,
      evidence: fallback.evidence
    };
  }

  const replicasTask = await createReplicasTask(input, prompt);

  return {
    provider: 'replicas',
    status: 'dispatched',
    taskName,
    taskTitle,
    prompt,
    replicasTask
  };
}

/**
 * Runs the scripted fallback through the runtime-appropriate PR creator.
 *
 * @param input Confirmed dispatch input from diagnosis.
 * @param options Dispatch behavior controls.
 * @returns Scripted fallback result with optional PR evidence.
 * @sideEffects May create a local git PR in dev or a GitHub API PR in serverless deployment.
 */
async function runScriptedFallbackForRuntime(
  input: DispatchInput,
  options: DispatchOptions
): Promise<ScriptedFallbackRun> {
  if (options.createPr && shouldUseGitHubApiScriptedFallback()) {
    return runScriptedFallbackViaGitHub(input);
  }
  return runScriptedFallback(input, { createPr: options.createPr });
}

/**
 * Checks whether scripted fallback PR creation should avoid local `git`/`gh`.
 *
 * @returns True on Vercel or when explicitly requested by environment.
 * @sideEffects Reads deployment environment variables.
 */
function shouldUseGitHubApiScriptedFallback(): boolean {
  return process.env.VERCEL === '1' || process.env.REFLEX_SCRIPTED_PR_PROVIDER === 'github-api';
}
