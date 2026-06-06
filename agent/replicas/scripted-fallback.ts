// Deterministic fallback for the agent-dispatch path.
//
// Why this exists: §13 Build/Fake/Name lists "pre-warmed sandbox" and "parallel fan-out if
// programmatic access is slow" as FAKE-able, and §12.5 gives every demo moment a fallback.
// Conference wifi dies; Replicas credits or the API key might not land in time. This path
// produces the SAME EvidencePayload from a pre-known fix on the seeded repo, so the demo
// reaches a real green PR even with no live agent. It uses the local `gh` CLI (already
// authenticated as Laurenceshao) to open the PR — no Replicas dependency.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { DispatchInput, EvidencePayload } from './types.js';

const run = promisify(execFile);

export interface ScriptedFix {
  /** Maps to the hypothesis this fallback satisfies. */
  hypothesisId: string;
  branch: string;
  rootCause: string;
  fixSummary: string;
  verification: string;
  /** Files to change: path -> full new contents. Applied in the repo working tree. */
  patch: Record<string, string>;
}

export interface ScriptedOptions {
  /** Absolute path to the local clone of the seeded demo repo. */
  repoDir: string;
  /** owner/name of the seeded repo (for gh). */
  repoSlug: string;
  baseBranch?: string;
  /** If true, don't actually push/open a PR — just report what would happen. */
  dryRun?: boolean;
}

/**
 * Apply a pre-known fix and open a real PR via `gh`. Returns the evidence payload Luke expects,
 * indistinguishable in shape from the live Replicas path.
 */
export async function dispatchScripted(
  input: DispatchInput,
  fix: ScriptedFix,
  opts: ScriptedOptions,
): Promise<EvidencePayload> {
  const { repoDir, repoSlug, baseBranch = 'main', dryRun = false } = opts;
  const git = (...args: string[]) => run('git', ['-C', repoDir, ...args]);

  if (dryRun) {
    return shaped(input, fix, '', 'reproduced');
  }

  await git('checkout', baseBranch);
  await git('checkout', '-B', fix.branch);

  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  for (const [rel, contents] of Object.entries(fix.patch)) {
    const abs = path.join(repoDir, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, contents, 'utf8');
    await git('add', rel);
  }

  await git('commit', '-m', `fix: ${fix.fixSummary}`);
  await git('push', '-u', 'origin', fix.branch, '--force');

  const body = [
    `**Root cause:** ${fix.rootCause}`,
    ``,
    `**Fix:** ${fix.fixSummary}`,
    ``,
    `**Verification:** ${fix.verification}`,
    ``,
    `Reflex session: \`${input.sessionId}\` · hypothesis: \`${fix.hypothesisId}\``,
  ].join('\n');

  const { stdout } = await run('gh', [
    'pr', 'create',
    '--repo', repoSlug,
    '--base', baseBranch,
    '--head', fix.branch,
    '--title', `Reflex fix: ${fix.fixSummary}`,
    '--body', body,
  ]);

  const prUrl = stdout.trim().split('\n').pop() ?? '';
  return shaped(input, fix, prUrl, 'shipped');
}

function shaped(
  input: DispatchInput,
  fix: ScriptedFix,
  prUrl: string,
  status: EvidencePayload['status'],
): EvidencePayload {
  return {
    sessionId: input.sessionId,
    hypothesisId: fix.hypothesisId,
    status,
    rootCause: fix.rootCause,
    fixSummary: fix.fixSummary,
    verification: fix.verification,
    logsUrl: '',
    prUrl,
    provider: 'scripted',
  };
}
