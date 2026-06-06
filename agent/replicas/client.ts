import { buildReplicasTaskName, buildReplicasTaskTitle } from './prompt';
import type { DispatchInput, ReplicasTask } from './types';

export interface ReplicasClientOptions {
  apiKey?: string;
  baseUrl?: string;
  environmentId?: string;
}

/**
 * Creates a live Replicas task when API credentials and environment are available.
 *
 * @param input Confirmed dispatch input from diagnosis.
 * @param prompt Prompt to send to the coding agent.
 * @param options Replicas API configuration.
 * @returns Replicas task metadata from the provider.
 * @sideEffects Performs a network request to the configured Replicas API.
 */
export async function createReplicasTask(
  input: DispatchInput,
  prompt: string,
  options: ReplicasClientOptions = {}
): Promise<ReplicasTask> {
  const apiKey = options.apiKey ?? process.env.REPLICAS_API_KEY;
  const environmentId = options.environmentId ?? process.env.REPLICAS_ENVIRONMENT_ID;
  const baseUrl = options.baseUrl ?? process.env.REPLICAS_BASE_URL ?? 'https://api.tryreplicas.com';

  if (!apiKey || !environmentId) {
    throw new Error('REPLICAS_API_KEY and REPLICAS_ENVIRONMENT_ID are required for live dispatch.');
  }

  const response = await fetch(`${baseUrl}/v1/replica`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      environmentId,
      name: buildReplicasTaskName(input),
      title: buildReplicasTaskTitle(input),
      repoUrl: input.repoUrl,
      prompt
    })
  });

  if (!response.ok) {
    throw new Error(`Replicas dispatch failed with HTTP ${response.status}: ${await response.text()}`);
  }

  const payload = (await response.json()) as Partial<ReplicasTask> & { logs_url?: string };

  return {
    id: String(payload.id ?? buildReplicasTaskName(input)),
    name: String(payload.name ?? buildReplicasTaskName(input)),
    title: String(payload.title ?? buildReplicasTaskTitle(input)),
    status: String(payload.status ?? 'running'),
    logsUrl: payload.logsUrl ?? payload.logs_url
  };
}
