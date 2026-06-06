import { createReplicasTask } from './client';
import { buildReplicasPrompt, buildReplicasTaskName, buildReplicasTaskTitle } from './prompt';
import { runScriptedFallback } from './scripted-fallback';
import type { DispatchInput, DispatchResult } from './types';

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
    const fallback = runScriptedFallback(input, { createPr: options.createPr });

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
