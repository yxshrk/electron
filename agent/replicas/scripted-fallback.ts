import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPullRequestBody, slugify } from './prompt';
import type { DispatchInput, EvidencePayload, ScriptedFallbackRun } from './types';

interface GitHubRepo {
  owner: string;
  name: string;
}

interface GitHubFileContent {
  sha: string;
  source: string;
}

export interface GitHubApiFallbackOptions {
  apiBaseUrl?: string;
  baseBranch?: string;
  repoUrl?: string;
  token?: string;
}

export interface ScriptedFallbackOptions {
  createPr?: boolean;
  repoRoot?: string;
  remote?: string;
}

const EXPORT_FILE = 'app/test-fixtures/reports/export.ts';
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
  if (isKnownExportFixAlreadyApplied(repoRoot)) {
    return {
      branchName,
      dryRun: true,
      failingCommand: FAILING_COMMAND,
      passingCommand: PASSING_COMMAND,
      prBody,
      evidence: buildScriptedEvidence(input, 'fixed')
    };
  }

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
 * Runs the scripted fallback PR path through GitHub's REST API.
 *
 * @param input Confirmed dispatch input from diagnosis.
 * @param options GitHub API configuration and optional repo/base branch override.
 * @returns Fallback run details and evidence payload.
 * @sideEffects Creates or reuses a branch, updates the seeded export file, and opens or reuses a PR.
 */
export async function runScriptedFallbackViaGitHub(
  input: DispatchInput,
  options: GitHubApiFallbackOptions = {}
): Promise<ScriptedFallbackRun> {
  const token = options.token ?? process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error('GITHUB_TOKEN is required for the serverless scripted fallback PR path.');
  }

  const repo = parseGitHubRepo(options.repoUrl ?? input.repoUrl);
  const apiBaseUrl = options.apiBaseUrl ?? process.env.GITHUB_API_URL ?? 'https://api.github.com';
  const baseBranch = options.baseBranch ?? process.env.GITHUB_BASE_BRANCH ?? 'main';
  const branchName = buildFallbackBranchName(input);
  const evidence = buildScriptedEvidence(input, 'shipped');
  const prBody = buildPullRequestBody(input, evidence, FAILING_COMMAND, PASSING_COMMAND);

  const baseFile = await getGitHubFileContent(apiBaseUrl, token, repo, EXPORT_FILE, baseBranch);
  if (isKnownExportFixSource(baseFile.source)) {
    return {
      branchName,
      dryRun: true,
      failingCommand: FAILING_COMMAND,
      passingCommand: PASSING_COMMAND,
      prBody,
      evidence: buildScriptedEvidence(input, 'fixed')
    };
  }

  const fixedSource = applyKnownExportFixToSource(baseFile.source);
  const baseSha = await getGitHubBranchSha(apiBaseUrl, token, repo, baseBranch);
  await createGitHubBranch(apiBaseUrl, token, repo, branchName, baseSha);

  const branchFile = await getGitHubFileContent(apiBaseUrl, token, repo, EXPORT_FILE, branchName);
  if (!isKnownExportFixSource(branchFile.source)) {
    await updateGitHubFile(apiBaseUrl, token, repo, EXPORT_FILE, branchName, branchFile.sha, fixedSource, input);
  }

  const prUrl = await createOrFindGitHubPullRequest(apiBaseUrl, token, repo, branchName, baseBranch, input, prBody);

  return {
    branchName,
    dryRun: false,
    failingCommand: FAILING_COMMAND,
    passingCommand: PASSING_COMMAND,
    prBody,
    evidence: {
      ...evidence,
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
 * @sideEffects Rewrites `app/test-fixtures/reports/export.ts` inside the target repository.
 */
export function applyKnownExportFix(repoRoot: string): void {
  const exportPath = join(repoRoot, EXPORT_FILE);
  const source = readFileSync(exportPath, 'utf8');
  writeFileSync(exportPath, applyKnownExportFixToSource(source));
}

/**
 * Checks whether the known seeded export bug has already been fixed in the target repo.
 *
 * @param repoRoot Repository root that contains the export implementation.
 * @returns True when the fixed default call is present and the seeded broken call is absent.
 * @sideEffects Reads `app/test-fixtures/reports/export.ts` from the target repository.
 */
function isKnownExportFixAlreadyApplied(repoRoot: string): boolean {
  const source = readFileSync(join(repoRoot, EXPORT_FILE), 'utf8');
  return isKnownExportFixSource(source);
}

/**
 * Checks whether source already contains the known export fix.
 *
 * @param source Export implementation source text.
 * @returns True when the fixed default call is present and the seeded broken call is absent.
 * @sideEffects None.
 */
function isKnownExportFixSource(source: string): boolean {
  return source.includes(FIXED_DEFAULT_CALL) && !source.includes(BROKEN_DEFAULT_CALL);
}

/**
 * Applies the known export fix to source text.
 *
 * @param source Export implementation source text.
 * @returns Updated source text with the bounded exporter as the default path.
 * @sideEffects None.
 */
function applyKnownExportFixToSource(source: string): string {
  if (!source.includes(BROKEN_DEFAULT_CALL)) {
    throw new Error(`Could not find seeded bug call in ${EXPORT_FILE}.`);
  }

  return source.replace(BROKEN_DEFAULT_CALL, FIXED_DEFAULT_CALL);
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

/**
 * Parses a GitHub repository identifier from a URL or `owner/repo` string.
 *
 * @param repoUrl GitHub HTTPS URL, SSH URL, or `owner/repo` shorthand.
 * @returns Parsed owner and repository name.
 * @sideEffects None.
 */
function parseGitHubRepo(repoUrl: string): GitHubRepo {
  const normalized = repoUrl.trim().replace(/\.git$/, '');
  const sshMatch = normalized.match(/^git@github\.com:([^/]+)\/(.+)$/);
  if (sshMatch) return { owner: sshMatch[1], name: sshMatch[2] };

  if (normalized.includes('github.com')) {
    const url = new URL(normalized);
    const [owner, name] = url.pathname.replace(/^\/+/, '').split('/');
    if (owner && name) return { owner, name };
  }

  const shorthand = normalized.match(/^([^/]+)\/([^/]+)$/);
  if (shorthand) return { owner: shorthand[1], name: shorthand[2] };

  throw new Error(`Unsupported GitHub repo URL: ${repoUrl}`);
}

/**
 * Reads a branch SHA from GitHub.
 *
 * @param apiBaseUrl GitHub API base URL.
 * @param token GitHub token with contents and pull request access.
 * @param repo Parsed repository owner/name.
 * @param branch Branch name to read.
 * @returns Commit SHA for the branch ref.
 * @sideEffects Performs a GitHub API request.
 */
async function getGitHubBranchSha(apiBaseUrl: string, token: string, repo: GitHubRepo, branch: string): Promise<string> {
  const ref = await githubRequest<{ object: { sha: string } }>(
    apiBaseUrl,
    token,
    `/repos/${repo.owner}/${repo.name}/git/ref/heads/${branch}`
  );
  return ref.object.sha;
}

/**
 * Creates a GitHub branch unless it already exists.
 *
 * @param apiBaseUrl GitHub API base URL.
 * @param token GitHub token with contents access.
 * @param repo Parsed repository owner/name.
 * @param branch Branch name to create.
 * @param sha Base commit SHA for the new branch.
 * @returns Nothing after the branch exists.
 * @sideEffects Performs a GitHub API request.
 */
async function createGitHubBranch(
  apiBaseUrl: string,
  token: string,
  repo: GitHubRepo,
  branch: string,
  sha: string
): Promise<void> {
  try {
    await githubRequest(apiBaseUrl, token, `/repos/${repo.owner}/${repo.name}/git/refs`, {
      method: 'POST',
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha })
    });
  } catch (error) {
    if (error instanceof GitHubRequestError && error.status === 422 && error.body.includes('Reference already exists')) {
      return;
    }
    throw error;
  }
}

/**
 * Reads one file's content from GitHub.
 *
 * @param apiBaseUrl GitHub API base URL.
 * @param token GitHub token with contents access.
 * @param repo Parsed repository owner/name.
 * @param path Repository-relative file path.
 * @param ref Branch or commit ref to read.
 * @returns File SHA and decoded UTF-8 source.
 * @sideEffects Performs a GitHub API request.
 */
async function getGitHubFileContent(
  apiBaseUrl: string,
  token: string,
  repo: GitHubRepo,
  path: string,
  ref: string
): Promise<GitHubFileContent> {
  const file = await githubRequest<{ content: string; encoding: string; sha: string }>(
    apiBaseUrl,
    token,
    `/repos/${repo.owner}/${repo.name}/contents/${path}?ref=${encodeURIComponent(ref)}`
  );
  if (file.encoding !== 'base64') {
    throw new Error(`Unsupported GitHub content encoding for ${path}: ${file.encoding}`);
  }
  return {
    sha: file.sha,
    source: Buffer.from(file.content.replace(/\n/g, ''), 'base64').toString('utf8')
  };
}

/**
 * Updates one file on a GitHub branch.
 *
 * @param apiBaseUrl GitHub API base URL.
 * @param token GitHub token with contents access.
 * @param repo Parsed repository owner/name.
 * @param path Repository-relative file path.
 * @param branch Branch to update.
 * @param sha Current file blob SHA on the branch.
 * @param source New UTF-8 file contents.
 * @param input Confirmed dispatch input used for the commit message.
 * @returns Nothing after GitHub accepts the update.
 * @sideEffects Performs a GitHub API request that creates a commit.
 */
async function updateGitHubFile(
  apiBaseUrl: string,
  token: string,
  repo: GitHubRepo,
  path: string,
  branch: string,
  sha: string,
  source: string,
  input: DispatchInput
): Promise<void> {
  await githubRequest(apiBaseUrl, token, `/repos/${repo.owner}/${repo.name}/contents/${path}`, {
    method: 'PUT',
    body: JSON.stringify({
      branch,
      sha,
      message: `reflex: fix large report export for ${input.runId}`,
      content: Buffer.from(source, 'utf8').toString('base64')
    })
  });
}

/**
 * Creates a pull request or returns the existing open PR for the same branch.
 *
 * @param apiBaseUrl GitHub API base URL.
 * @param token GitHub token with pull request access.
 * @param repo Parsed repository owner/name.
 * @param branch Source branch name.
 * @param baseBranch Target branch name.
 * @param input Confirmed dispatch input used for the PR title.
 * @param prBody Markdown PR body.
 * @returns Pull request URL.
 * @sideEffects Performs GitHub API requests.
 */
async function createOrFindGitHubPullRequest(
  apiBaseUrl: string,
  token: string,
  repo: GitHubRepo,
  branch: string,
  baseBranch: string,
  input: DispatchInput,
  prBody: string
): Promise<string> {
  try {
    const pr = await githubRequest<{ html_url: string }>(apiBaseUrl, token, `/repos/${repo.owner}/${repo.name}/pulls`, {
      method: 'POST',
      body: JSON.stringify({
        title: `[Reflex] Fix large report export for ${input.runId}`,
        head: branch,
        base: baseBranch,
        body: prBody
      })
    });
    return pr.html_url;
  } catch (error) {
    if (!(error instanceof GitHubRequestError) || error.status !== 422) throw error;
    const existing = await findExistingGitHubPullRequest(apiBaseUrl, token, repo, branch, baseBranch);
    if (existing) return existing;
    throw error;
  }
}

/**
 * Finds an open pull request for a source branch and base branch.
 *
 * @param apiBaseUrl GitHub API base URL.
 * @param token GitHub token with pull request access.
 * @param repo Parsed repository owner/name.
 * @param branch Source branch name.
 * @param baseBranch Target branch name.
 * @returns Existing pull request URL, or undefined when none is open.
 * @sideEffects Performs a GitHub API request.
 */
async function findExistingGitHubPullRequest(
  apiBaseUrl: string,
  token: string,
  repo: GitHubRepo,
  branch: string,
  baseBranch: string
): Promise<string | undefined> {
  const qs = new URLSearchParams({
    head: `${repo.owner}:${branch}`,
    base: baseBranch,
    state: 'open'
  });
  const prs = await githubRequest<Array<{ html_url: string }>>(
    apiBaseUrl,
    token,
    `/repos/${repo.owner}/${repo.name}/pulls?${qs.toString()}`
  );
  return prs[0]?.html_url;
}

/**
 * Performs a GitHub API request with Reflex's required headers.
 *
 * @param apiBaseUrl GitHub API base URL.
 * @param token GitHub token.
 * @param path API path including a leading slash and optional query string.
 * @param init Fetch options.
 * @returns Parsed JSON response typed by the caller.
 * @sideEffects Performs a network request.
 */
async function githubRequest<T = unknown>(
  apiBaseUrl: string,
  token: string,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...init.headers
    }
  });

  if (!response.ok) {
    throw new GitHubRequestError(response.status, await response.text());
  }

  return response.json() as Promise<T>;
}

class GitHubRequestError extends Error {
  /**
   * Creates an error that preserves GitHub's HTTP status and response body.
   *
   * @param status HTTP status code returned by GitHub.
   * @param body Response body returned by GitHub.
   * @sideEffects None.
   */
  constructor(
    readonly status: number,
    readonly body: string
  ) {
    super(`GitHub API request failed (${status}): ${body.slice(0, 300)}`);
  }
}
