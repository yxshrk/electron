import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPullRequestBody, slugify } from './prompt';
import type { DispatchInput, EvidencePayload, ScriptedFallbackRun } from './types';

export interface ScriptedFallbackOptions {
  createPr?: boolean;
  repoRoot?: string;
  remote?: string;
}

const EXPORT_FILE = 'lib/reports/export.ts';
const FAILING_COMMAND = 'npm run test:export-large:repro';
const PASSING_COMMAND = 'npm run test:export-large:fixed';
const BROKEN_DEFAULT_CALL = 'return exportReportCsvUnbounded(records, options);';
const FIXED_DEFAULT_CALL = 'return exportReportCsvBatched(records, options);';

/**
 * Runs the scripted fallback path for the seeded export-hang bug.
 *
 * @param input Confirmed dispatch input from diagnosis.
 * @param options Fallback execution options.
 * @returns Fallback run details and evidence payload.
 * @sideEffects Optionally creates a branch, edits the export file, commits, pushes, and opens a PR.
 */
export function runScriptedFallback(
  input: DispatchInput,
  options: ScriptedFallbackOptions = {}
): ScriptedFallbackRun {
  const branchName = buildFallbackBranchName(input);
  const evidence = buildScriptedEvidence(input, options.createPr ? 'shipped' : 'fixed');
  const prBody = buildPullRequestBody(input, evidence, FAILING_COMMAND, PASSING_COMMAND);

  if (!options.createPr) {
    return {
      branchName,
      dryRun: true,
      failingCommand: FAILING_COMMAND,
      passingCommand: PASSING_COMMAND,
      prBody,
      evidence
    };
  }

  const repoRoot = options.repoRoot ?? process.cwd();
  assertCleanWorktree(repoRoot);
  runCommand(repoRoot, 'git', ['checkout', '-b', branchName]);
  assertCommandFails(repoRoot, FAILING_COMMAND.split(' '));
  applyKnownExportFix(repoRoot);
  runCommand(repoRoot, 'npm', ['run', 'test:export-large:fixed']);
  runCommand(repoRoot, 'git', ['add', EXPORT_FILE]);
  runCommand(repoRoot, 'git', ['commit', '-m', `reflex: fix large report export for ${input.runId}`]);
  runCommand(repoRoot, 'git', ['push', '-u', options.remote ?? 'origin', branchName]);

  const prUrl = createPullRequest(repoRoot, input, prBody);

  return {
    branchName,
    dryRun: false,
    failingCommand: FAILING_COMMAND,
    passingCommand: PASSING_COMMAND,
    prBody,
    evidence: {
      ...evidence,
      status: 'shipped',
      prUrl
    }
  };
}

/**
 * Builds the fallback branch name for a run and hypothesis.
 *
 * @param input Confirmed dispatch input from diagnosis.
 * @returns Git branch name for the scripted fallback fix.
 * @sideEffects None.
 */
export function buildFallbackBranchName(input: DispatchInput): string {
  return `reflex/${input.runId}/${slugify(input.hypothesis.title) || 'fix'}`;
}

/**
 * Applies the known minimal export fix to the seeded export implementation.
 *
 * @param repoRoot Repository root that contains the export implementation.
 * @returns Nothing.
 * @sideEffects Rewrites `lib/reports/export.ts` inside the target repository.
 */
export function applyKnownExportFix(repoRoot: string): void {
  const exportPath = join(repoRoot, EXPORT_FILE);
  const source = readFileSync(exportPath, 'utf8');

  if (!source.includes(BROKEN_DEFAULT_CALL)) {
    throw new Error(`Could not find seeded bug call in ${EXPORT_FILE}.`);
  }

  writeFileSync(exportPath, source.replace(BROKEN_DEFAULT_CALL, FIXED_DEFAULT_CALL));
}

/**
 * Builds the evidence payload for the known export-hang fix.
 *
 * @param input Confirmed dispatch input from diagnosis.
 * @param status Evidence status to return.
 * @returns Evidence payload for Yash's persistence layer.
 * @sideEffects None.
 */
function buildScriptedEvidence(input: DispatchInput, status: EvidencePayload['status']): EvidencePayload {
  return {
    runId: input.runId,
    hypothesisId: input.hypothesis.id,
    status,
    rootCause: 'Report export uses the unbounded synchronous export path for large datasets.',
    fixSummary: 'Route the default export through the bounded batched exporter.',
    verification: 'Large export fixture completes under the demo timeout with the default export path.',
    provider: 'scripted'
  };
}

/**
 * Ensures the scripted fallback starts without tracked git changes.
 *
 * @param repoRoot Repository root to inspect.
 * @returns Nothing.
 * @sideEffects Reads git status while ignoring untracked local files.
 */
function assertCleanWorktree(repoRoot: string): void {
  const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {
    cwd: repoRoot,
    encoding: 'utf8'
  });

  if (status.trim()) {
    throw new Error('Scripted fallback requires no tracked worktree changes before it creates a fix branch.');
  }
}

/**
 * Runs a command and throws if it fails.
 *
 * @param cwd Working directory for the command.
 * @param command Executable name.
 * @param args Command arguments.
 * @returns Captured stdout.
 * @sideEffects Executes a child process.
 */
function runCommand(cwd: string, command: string, args: string[]): string {
  return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/**
 * Runs a command and throws if it unexpectedly succeeds.
 *
 * @param cwd Working directory for the command.
 * @param command Command and arguments.
 * @returns Nothing.
 * @sideEffects Executes a child process.
 */
function assertCommandFails(cwd: string, command: string[]): void {
  const [bin, ...args] = command;
  const result = spawnSync(bin, args, { cwd, encoding: 'utf8' });

  if (result.status === 0) {
    throw new Error(`${command.join(' ')} unexpectedly passed before the fix.`);
  }
}

/**
 * Opens the scripted fallback PR through GitHub CLI.
 *
 * @param repoRoot Repository root used by the GitHub CLI.
 * @param input Confirmed dispatch input from diagnosis.
 * @param prBody Markdown PR body.
 * @returns Created pull request URL.
 * @sideEffects Writes a temporary PR body and invokes `gh pr create`.
 */
function createPullRequest(repoRoot: string, input: DispatchInput, prBody: string): string {
  const tempDir = mkdtempSync(join(tmpdir(), 'reflex-pr-'));
  const bodyFile = join(tempDir, 'body.md');
  writeFileSync(bodyFile, prBody);

  return runCommand(repoRoot, 'gh', [
    'pr',
    'create',
    '--title',
    `[Reflex] Fix large report export for ${input.runId}`,
    '--body-file',
    bodyFile
  ]).trim();
}
