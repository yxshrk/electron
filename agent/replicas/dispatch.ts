// The Reflex agent-dispatch path: hypothesis -> Replicas agent reproduces, fixes,
// opens a PR -> we return the evidence payload Luke expects.
//
// Spine (TECHNICAL_DOCUMENT.md §19):  structured symptom -> reproduction -> fix -> green PR.
// The judging point is that confidence comes from REPRODUCTION, not an LLM guess —
// so the brief forces the agent to prove the failure before fixing it.

import { ReplicasClient, extractPrUrl } from './client.js';
import type { DispatchInput, EvidencePayload, ReplicaEvent } from './types.js';

/** Build the agent brief. Reproduce → confirm expected failure → minimal fix → test → PR. */
export function buildBrief(input: DispatchInput): string {
  const { symptom, role, hypothesis } = input;
  return [
    `You are a debugging agent for "Reflex". A ${role} reported a problem.`,
    ``,
    `SYMPTOM: ${symptom}`,
    `HYPOTHESIS TO TEST: ${hypothesis.title}`,
    ``,
    `Do this, in order, and do not skip step 1:`,
    `1. REPRODUCE first. ${hypothesis.reproductionPlan}`,
    `   You must observe the expected failure before changing any code:`,
    `   "${hypothesis.expectedFailure}". Capture the proof (failing test output, logs, or timing).`,
    `   If you CANNOT reproduce it, stop and report status "reproduction_failed" — do not invent a fix.`,
    `2. Localize the root cause in the code.`,
    `3. Write the MINIMAL fix. No refactors, no unrelated changes.`,
    `4. Add or update a test that fails before the fix and passes after it. Run the test suite.`,
    `5. Open a pull request. The PR body must include: the root cause, a one-line fix summary,`,
    `   and the before/after verification evidence from step 1 and step 4.`,
    ``,
    `End your final message with a JSON block exactly in this shape:`,
    `\`\`\`json`,
    `{"rootCause":"...","fixSummary":"...","verification":"...","reproduced":true}`,
    `\`\`\``,
  ].join('\n');
}

/** Parse the trailing JSON block the agent emits in its final turn. */
function parseAgentSummary(text: string): {
  rootCause?: string;
  fixSummary?: string;
  verification?: string;
  reproduced?: boolean;
} {
  const match = text.match(/```json\s*([\s\S]*?)```/i);
  if (!match) return {};
  try {
    return JSON.parse(match[1].trim());
  } catch {
    return {};
  }
}

export interface DispatchOptions {
  client?: ReplicasClient;
  /** Called on every Replicas SSE event — wire this to InsForge / the pipeline UI. */
  onEvent?: (event: ReplicaEvent) => void;
  /** Hard ceiling so a stuck agent can't hang the demo. Default 8 min. */
  timeoutMs?: number;
}

/**
 * Dispatch one hypothesis to a real Replicas agent and resolve with the evidence payload.
 * Streams events live (for the pipeline dashboard) and finishes when a PR appears or the
 * agent's turn completes.
 */
export async function dispatchHypothesis(
  input: DispatchInput,
  opts: DispatchOptions = {},
): Promise<EvidencePayload> {
  const client = opts.client ?? new ReplicasClient();
  const timeoutMs = opts.timeoutMs ?? 8 * 60_000;
  const emit = opts.onEvent ?? (() => {});

  const replica = await client.createReplica({
    name: `reflex-${input.sessionId}-${input.hypothesis.id}`.replace(/\s+/g, '-'),
    message: buildBrief(input),
    environment_id: input.environmentId,
    thinking_level: 'high',
  });

  let lastTurnText = '';
  let prUrl = extractPrUrl(replica);

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);

  try {
    await client.streamEvents(
      replica.id,
      (event) => {
        emit(event);
        // Capture the final assistant text so we can parse the summary JSON.
        if (event.type === 'chat.turn.completed') {
          lastTurnText = event.payload?.text ?? event.payload?.message ?? lastTurnText;
        }
        const eventPr = extractPrUrl(event);
        if (eventPr) prUrl = eventPr;
      },
      // Stop once the PR is open or the agent finishes its turn.
      (event) => Boolean(extractPrUrl(event)) || event.type === 'chat.turn.completed',
      abort.signal,
    );
  } finally {
    clearTimeout(timer);
  }

  // Backfill via a final poll (covers the case where the PR landed after the stream closed).
  if (!prUrl) {
    const fresh = await client.getReplica(replica.id, 'diffs').catch(() => null);
    if (fresh) prUrl = extractPrUrl(fresh);
  }

  const summary = parseAgentSummary(lastTurnText);

  const status: EvidencePayload['status'] = prUrl
    ? 'shipped'
    : summary.reproduced === false
      ? 'reproduction_failed'
      : summary.reproduced
        ? 'reproduced'
        : 'pr_failed';

  return {
    sessionId: input.sessionId,
    hypothesisId: input.hypothesis.id,
    status,
    rootCause: summary.rootCause ?? '',
    fixSummary: summary.fixSummary ?? '',
    verification: summary.verification ?? '',
    logsUrl: `https://tryreplicas.com/dashboard/replica/${replica.id}`,
    prUrl: prUrl ?? '',
    provider: 'replicas',
  };
}
