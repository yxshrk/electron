import type { DispatchInput, EvidencePayload } from './types';

/**
 * Builds the canonical Replicas task name for a confirmed hypothesis.
 *
 * @param input Confirmed dispatch input from diagnosis.
 * @returns Stable task name used for Replicas and callback correlation.
 * @sideEffects None.
 */
export function buildReplicasTaskName(input: DispatchInput): string {
  return `replicas_${input.runId}_${slugify(input.hypothesis.title)}`;
}

/**
 * Builds the canonical Replicas task title for a confirmed hypothesis.
 *
 * @param input Confirmed dispatch input from diagnosis.
 * @returns Human-readable task title.
 * @sideEffects None.
 */
export function buildReplicasTaskTitle(input: DispatchInput): string {
  return `[Reflex] ${input.symptom} - ${input.hypothesis.title}`;
}

/**
 * Formats the prompt sent to Replicas or the scripted fallback.
 *
 * @param input Confirmed dispatch input from diagnosis.
 * @returns Agent prompt grounded in the confirmed intake package.
 * @sideEffects None.
 */
export function buildReplicasPrompt(input: DispatchInput): string {
  return `You are a coding agent working in a sandboxed development environment.

Goal:
Reproduce the confirmed bug, identify the smallest credible fix, verify it, and open a PR.

Hard rules:
- First reproduce the bug before changing code.
- Do not broaden scope beyond the selected hypothesis.
- Prefer a minimal patch over a refactor.
- Record the failing command/output before the fix and the passing command/output after the fix.
- Include evidence in the PR body.

Run:
- runId: ${input.runId}
- intakePackageId: ${input.intakePackageId}
- repoUrl: ${input.repoUrl}
- role: ${input.role}

Engineering symptom:
${input.symptom}

Selected hypothesis:
- hypothesisId: ${input.hypothesis.id}
- title: ${input.hypothesis.title}
- reproductionPlan: ${input.hypothesis.reproductionPlan}
- expectedFailure: ${input.hypothesis.expectedFailure}

Required output:
1. Reproduction result with command and failing output.
2. Root cause summary.
3. Minimal fix.
4. Verification result with command and passing output.
5. GitHub PR URL.`;
}

/**
 * Builds the PR body used by Replicas or the scripted fallback.
 *
 * @param input Confirmed dispatch input from diagnosis.
 * @param evidence Evidence collected by the scripted or Replicas path.
 * @param failingCommand Command that reproduced the issue before the fix.
 * @param passingCommand Command that verified the fix.
 * @returns Markdown PR body with source run, evidence, root cause, fix, and verification.
 * @sideEffects None.
 */
export function buildPullRequestBody(
  input: DispatchInput,
  evidence: EvidencePayload,
  failingCommand: string,
  passingCommand: string
): string {
  return `## Reflex Fix

Source run: ${input.runId}
Intake package: ${input.intakePackageId}
Role: ${input.role}
Symptom: ${input.symptom}

## Confirmed Report

- Hypothesis: ${input.hypothesis.title}
- Expected failure: ${input.hypothesis.expectedFailure}
- Reproduction plan: ${input.hypothesis.reproductionPlan}

## Evidence Used

- Provider: ${evidence.provider}
- Status: ${evidence.status}

## Reproduction

Before fix:
\`${failingCommand}\`

Result:
${input.hypothesis.expectedFailure}

## Root Cause

${evidence.rootCause}

## Fix

${evidence.fixSummary}

## Verification

After fix:
\`${passingCommand}\`

Result:
${evidence.verification}
`;
}

/**
 * Converts arbitrary text into a stable lowercase slug.
 *
 * @param value Text to slugify.
 * @returns Lowercase slug suitable for branch and task names.
 * @sideEffects None.
 */
export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}
