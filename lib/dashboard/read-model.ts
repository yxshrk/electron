import { dbSelect } from '@/lib/insforge/db';
import type { ReflexRunRow } from '@/lib/insforge/types';

export interface DashboardRun extends ReflexRunRow {
  summary?: string;
  media_count?: number;
  chat_message_count?: number;
  hypothesis_count?: number;
  diagnosis_state?: 'not_started' | 'diagnosed';
  pr_url?: string | null;
  pr_summary?: string | null;
}

export interface DashboardRunEvent {
  id: string;
  event_type: string;
  status: string | null;
  title: string;
  detail: string;
  created_at: string;
}

export interface DashboardDiagnosis {
  id: string;
  symptom: string;
  role_lens: string;
  evidence?: string[];
  created_at?: string;
}

export interface DashboardHypothesis {
  id: string;
  title: string;
  confidence: number;
  reproduction_plan: string;
  expected_failure: string;
  status: string;
}

export interface DashboardMediaArtifact {
  id: string;
  kind: string;
  source: string;
  storage_url: string;
  thumbnail_url?: string | null;
  summary: string | null;
  safe_to_share?: boolean;
  created_at?: string;
}

export interface DashboardBugBrief {
  id: string;
  where_it_happens: string;
  actual_behavior: string;
  expected_behavior: string | null;
  reproduction_context: string | null;
  affected_surface: string;
  evidence_summary?: Array<{ kind: string; mediaArtifactId?: string; summary: string }>;
  missing_info?: string[];
  agent_prompt_preview: string;
  status: string;
  created_at?: string;
  confirmed_at?: string | null;
}

export interface DashboardIntakePackage {
  id: string;
  confirmed_report: Record<string, unknown>;
  chat_history: unknown[];
  media_artifacts: unknown[];
  debug_capture_artifacts: unknown[];
  status: string;
}

export interface DashboardSlackMessage {
  id: string;
  slack_message_ts: string;
  slack_user_id: string | null;
  text: string;
  permalink: string | null;
  has_files: boolean;
  created_at?: string;
}

export interface DashboardAgentRun {
  id: string;
  provider: string;
  status: string;
  sandbox_url?: string | null;
  logs_url: string | null;
  result: Record<string, unknown>;
  created_at?: string;
  completed_at?: string | null;
}

export interface DashboardPullRequest {
  id: string;
  github_url: string;
  root_cause: string;
  summary: string;
  verification: string;
  created_at?: string;
}

export interface DashboardObservation {
  id: string;
  transcript: string;
  screenshot_url: string | null;
  visible_state: Record<string, unknown>;
  created_at: string;
}

export interface DashboardListResult {
  source: 'insforge' | 'demo_fixture';
  error?: string;
  runs: DashboardRun[];
}

export interface DashboardRunDetail {
  source: 'insforge' | 'demo_fixture';
  error?: string;
  run: DashboardRun;
  events: DashboardRunEvent[];
  chatHistory: DashboardSlackMessage[];
  mediaArtifacts: DashboardMediaArtifact[];
  bugBriefs: DashboardBugBrief[];
  intakePackages: DashboardIntakePackage[];
  observations: DashboardObservation[];
  diagnoses: DashboardDiagnosis[];
  hypotheses: DashboardHypothesis[];
  agentRuns: DashboardAgentRun[];
  pullRequests: DashboardPullRequest[];
}

const DEMO_CREATED_AT = '2026-06-06T20:00:00.000Z';
const DEMO_RUN_ID = 'run_export_hang_01';

type RunScoped<T> = T & { run_id: string };

const demoRun: DashboardRun = {
  id: DEMO_RUN_ID,
  run_key: DEMO_RUN_ID,
  source: 'slack',
  mode: 'bug',
  role: 'sales_csm',
  repo_url: 'https://github.com/yxshrk/electron',
  command_text: '',
  slack_channel_id: 'C_DEMO',
  slack_thread_ts: null,
  context_window: { messageLimit: 100, attachments: 3, maxPromptChars: 6000 },
  status: 'shipped',
  created_at: DEMO_CREATED_AT,
  completed_at: '2026-06-06T20:03:30.000Z',
  summary: 'Report export hangs on large datasets',
  media_count: 2,
  chat_message_count: 3,
  hypothesis_count: 3,
  diagnosis_state: 'diagnosed',
  pr_url: 'https://github.com/yxshrk/electron/pull/10',
  pr_summary: 'Batched exporter with reproduction proof'
};

/**
 * Reads the dashboard run list from InsForge, falling back to a deterministic demo row when setup is absent.
 *
 * @returns Dashboard run list and source metadata.
 * @sideEffects Performs InsForge network reads when credentials are configured.
 */
export async function getDashboardRuns(): Promise<DashboardListResult> {
  try {
    const runs = await dbSelect<DashboardRun>(
      'reflex_runs',
      'order=created_at.desc&limit=100'
    );
    try {
      return { source: 'insforge', runs: await enrichRunSummaries(runs) };
    } catch (error) {
      return {
        source: 'insforge',
        error: `Showing partial run rows because related dashboard data could not be loaded: ${errorMessage(error)}`,
        runs: runs.map((run) => ({ ...run, summary: summarizeRun(run), pr_url: null }))
      };
    }
  } catch (error) {
    return { source: 'demo_fixture', error: errorMessage(error), runs: [demoRun] };
  }
}

/**
 * Reads the complete dashboard detail bundle for one run.
 *
 * @param runId Run database ID or demo run key.
 * @returns Complete dashboard bundle, or `null` when the run does not exist.
 * @sideEffects Performs InsForge network reads when credentials are configured.
 */
export async function getDashboardRunDetail(runId: string): Promise<DashboardRunDetail | null> {
  try {
    const run = await findRun(runId);
    if (!run) return null;

    const [events, chatHistory, mediaArtifacts, bugBriefs, intakePackages, observations, diagnoses, pullRequests] =
      await Promise.all([
        dbSelect<DashboardRunEvent>('run_events', `run_id=eq.${run.id}&order=created_at.asc&limit=200`),
        dbSelect<DashboardSlackMessage>('slack_context_messages', `run_id=eq.${run.id}&order=created_at.asc`),
        dbSelect<DashboardMediaArtifact>('media_artifacts', `run_id=eq.${run.id}&order=created_at.asc`),
        dbSelect<DashboardBugBrief>('bug_briefs', `run_id=eq.${run.id}&order=created_at.desc`),
        dbSelect<DashboardIntakePackage>('intake_packages', `run_id=eq.${run.id}&order=created_at.desc`),
        dbSelect<DashboardObservation>('observations', `run_id=eq.${run.id}&order=created_at.desc`),
        dbSelect<DashboardDiagnosis>('diagnoses', `run_id=eq.${run.id}&order=created_at.desc`),
        dbSelect<DashboardPullRequest>('pull_requests', `run_id=eq.${run.id}&order=created_at.desc`)
      ]);

    const hypotheses = diagnoses[0]
      ? await dbSelect<DashboardHypothesis>(
          'hypotheses',
          `diagnosis_id=eq.${diagnoses[0].id}&order=confidence.desc`
        )
      : [];
    const agentRuns = await readAgentRuns(hypotheses);

    return {
      source: 'insforge',
      run,
      events,
      chatHistory,
      mediaArtifacts,
      bugBriefs,
      intakePackages,
      observations,
      diagnoses,
      hypotheses,
      agentRuns,
      pullRequests
    };
  } catch (error) {
    if (runId !== DEMO_RUN_ID) return null;
    return { ...demoDetail(), error: errorMessage(error) };
  }
}

/**
 * Adds diagnosis, evidence, hypothesis, and PR summary fields to run rows for the overview table.
 *
 * @param runs Base run rows from `reflex_runs`.
 * @returns Run rows enriched with dashboard-only read-model fields.
 * @sideEffects Performs bounded InsForge reads for related run data.
 */
async function enrichRunSummaries(runs: DashboardRun[]): Promise<DashboardRun[]> {
  if (runs.length === 0) return [];
  const runFilter = `run_id=in.${inList(runs.map((run) => run.id))}`;

  const [diagnoses, briefs, media, chatHistory, pullRequests] = await Promise.all([
    dbSelect<RunScoped<DashboardDiagnosis>>('diagnoses', `${runFilter}&order=created_at.desc`),
    dbSelect<RunScoped<DashboardBugBrief>>('bug_briefs', `${runFilter}&order=created_at.desc`),
    dbSelect<{ id: string; run_id: string }>('media_artifacts', `${runFilter}&select=id,run_id`),
    dbSelect<{ id: string; run_id: string }>('slack_context_messages', `${runFilter}&select=id,run_id`),
    dbSelect<RunScoped<DashboardPullRequest>>('pull_requests', `${runFilter}&order=created_at.desc`)
  ]);

  const latestDiagnosisByRun = firstByRunId(diagnoses);
  const latestBriefByRun = firstByRunId(briefs);
  const latestPullRequestByRun = firstByRunId(pullRequests);
  const diagnosisIds = diagnoses.map((diagnosis) => diagnosis.id);
  const hypotheses = diagnosisIds.length > 0
    ? await dbSelect<{ id: string; diagnosis_id: string }>(
        'hypotheses',
        `diagnosis_id=in.${inList(diagnosisIds)}&select=id,diagnosis_id`
      )
    : [];
  const hypothesisCountByDiagnosis = countBy(hypotheses, (hypothesis) => hypothesis.diagnosis_id);
  const mediaCountByRun = countBy(media, (artifact) => artifact.run_id);
  const chatCountByRun = countBy(chatHistory, (message) => message.run_id);

  return runs.map((run) => {
    const diagnosis = latestDiagnosisByRun.get(run.id);
    const pr = latestPullRequestByRun.get(run.id);
    return {
      ...run,
      summary: summarizeRun(run, diagnosis, latestBriefByRun.get(run.id)),
      media_count: mediaCountByRun.get(run.id) ?? 0,
      chat_message_count: chatCountByRun.get(run.id) ?? 0,
      hypothesis_count: diagnosis ? hypothesisCountByDiagnosis.get(diagnosis.id) ?? 0 : 0,
      diagnosis_state: diagnosis ? 'diagnosed' : 'not_started',
      pr_url: pr?.github_url ?? null,
      pr_summary: pr?.summary ?? null
    };
  });
}

/**
 * Chooses the best one-line summary for the overview page.
 *
 * @param run Base run row.
 * @param diagnosis Latest diagnosis row, when present.
 * @param brief Latest bug brief row, when present.
 * @returns Human-readable summary for the run.
 * @sideEffects None.
 */
function summarizeRun(
  run: DashboardRun,
  diagnosis?: DashboardDiagnosis,
  brief?: DashboardBugBrief
): string {
  return (
    diagnosis?.symptom ||
    brief?.actual_behavior ||
    run.command_text ||
    run.repo_url.replace('https://github.com/', '')
  );
}

/**
 * Formats IDs for a PostgREST `in.(...)` filter.
 *
 * @param values Values to include in the filter.
 * @returns Parenthesized comma-separated filter value.
 * @sideEffects None.
 */
function inList(values: string[]): string {
  return `(${values.join(',')})`;
}

/**
 * Keeps the first row per run ID from an already-sorted result set.
 *
 * @param rows Rows containing a `run_id` field.
 * @returns Map keyed by run ID.
 * @sideEffects None.
 */
function firstByRunId<T extends { run_id: string }>(rows: T[]): Map<string, T> {
  const result = new Map<string, T>();
  for (const row of rows) {
    if (!result.has(row.run_id)) result.set(row.run_id, row);
  }
  return result;
}

/**
 * Counts rows by a selected key.
 *
 * @param rows Rows to count.
 * @param keyFor Function that returns the grouping key.
 * @returns Count map keyed by the selected value.
 * @sideEffects None.
 */
function countBy<T>(rows: T[], keyFor: (row: T) => string): Map<string, number> {
  const result = new Map<string, number>();
  for (const row of rows) {
    const key = keyFor(row);
    result.set(key, (result.get(key) ?? 0) + 1);
  }
  return result;
}

/**
 * Returns every table the MVP migration must create.
 *
 * @returns Ordered list of expected MVP table names.
 * @sideEffects None.
 */
export function expectedSchemaTables(): string[] {
  return [
    'reflex_runs',
    'run_events',
    'slack_context_messages',
    'observations',
    'media_artifacts',
    'bug_briefs',
    'intake_packages',
    'diagnoses',
    'hypotheses',
    'agent_runs',
    'pull_requests'
  ];
}

/**
 * Finds a run by database ID, then by human-readable run key.
 *
 * @param runId Run database ID or run key.
 * @returns Matching dashboard run row.
 * @sideEffects Performs InsForge network reads.
 */
async function findRun(runId: string): Promise<DashboardRun | null> {
  const byKey = await dbSelect<DashboardRun>('reflex_runs', `run_key=eq.${runId}&limit=1`);
  if (byKey[0]) return byKey[0];
  if (!isUuid(runId)) return null;
  const byId = await dbSelect<DashboardRun>('reflex_runs', `id=eq.${runId}&limit=1`);
  return byId[0] ?? null;
}

/**
 * Checks whether a value can be used against the UUID primary key column.
 *
 * @param value Candidate run identifier.
 * @returns Whether the value is UUID-shaped.
 * @sideEffects None.
 */
function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/**
 * Reads agent runs for the selected hypotheses.
 *
 * @param hypotheses Hypotheses displayed in the dashboard.
 * @returns Agent runs associated with the hypotheses.
 * @sideEffects Performs InsForge network reads.
 */
async function readAgentRuns(hypotheses: DashboardHypothesis[]): Promise<DashboardAgentRun[]> {
  if (hypotheses.length === 0) return [];
  const ids = hypotheses.map((hypothesis) => hypothesis.id).join(',');
  return dbSelect<DashboardAgentRun>('agent_runs', `hypothesis_id=in.(${ids})&order=created_at.desc`);
}

/**
 * Builds the deterministic demo detail bundle used when InsForge credentials are not configured.
 *
 * @returns Dashboard detail bundle for the seeded export-hang run.
 * @sideEffects None.
 */
function demoDetail(): DashboardRunDetail {
  return {
    source: 'demo_fixture',
    run: demoRun,
    events: [
      event('run.created', 'created', 'Run created', 'Slack report started from /reflex-report', 0),
      event('context.stored', 'context_stored', 'Context stored', 'Used 8 Slack messages and 2 files', 20),
      event('report.drafted', 'report_drafted', 'Bug report drafted', 'Report export screen hangs on large datasets', 45),
      event('package.confirmed', 'package_confirmed', 'Package confirmed', 'CSM confirmed the report', 70),
      event('diagnosis.created', 'diagnosed', 'Diagnosis ready', 'Top hypothesis: unbounded report query', 100),
      event('agent.reproduced', 'reproduced', 'Bug reproduced', 'Large export exceeded synchronous row budget', 140),
      event('agent.fixed', 'fixed', 'Fix verified', 'Batched export path completed large fixture', 180),
      event('pr.opened', 'shipped', 'PR opened', 'PR linked with reproduction evidence', 210)
    ],
    chatHistory: [
      {
        id: 'msg_demo_1',
        slack_message_ts: '1710000000.000100',
        slack_user_id: 'U_CSM',
        text: 'Customer says large report export hangs and then the frontend crashes.',
        permalink: null,
        has_files: true
      }
    ],
    mediaArtifacts: [
      artifact('media_export_video_1', 'video', 'slack_file', 'export clicked, spinner appears, frontend crashes'),
      artifact('media_export_screenshot_1', 'screenshot', 'slack_file', 'report export screen stuck in loading state')
    ],
    bugBriefs: [
      {
        id: 'brief_run_export_hang_01',
        where_it_happens: 'Report export screen',
        actual_behavior: 'Large report export hangs or crashes.',
        expected_behavior: 'Export should complete or show progress.',
        reproduction_context: 'CSM attached a short recording and screenshot from the customer reporting page.',
        affected_surface: 'frontend',
        evidence_summary: [
          { kind: 'slack_message', summary: 'CSM reports the large export hangs and then crashes.' },
          { kind: 'video', mediaArtifactId: 'media_export_video_1', summary: 'Recording shows export click followed by stuck loading state.' },
          { kind: 'screenshot', mediaArtifactId: 'media_export_screenshot_1', summary: 'Screenshot captures the report export screen in a stuck state.' }
        ],
        missing_info: ['Exact customer dataset size is approximate', 'Browser/version not captured'],
        agent_prompt_preview:
          'Investigate the report export flow for large datasets. Reproduce from the attached recording and Slack context before changing code. Focus on whether the frontend waits on an unbounded backend export response or blocks while building the export payload.',
        status: 'confirmed'
      }
    ],
    intakePackages: [
      {
        id: 'pkg_run_export_hang_01',
        confirmed_report: {
          whereItHappens: 'Report export screen',
          actualBehavior: 'Large report export hangs or crashes.',
          expectedBehavior: 'Export should complete or show progress.',
          affectedSurface: 'frontend'
        },
        chat_history: ['msg_demo_1'],
        media_artifacts: ['media_export_video_1', 'media_export_screenshot_1'],
        debug_capture_artifacts: [],
        status: 'confirmed'
      }
    ],
    observations: [
      {
        id: 'obs_export_hang_01',
        transcript: 'Customer says the export hangs after clicking Export on a large report. Recording shows spinner stuck and no file download.',
        screenshot_url: null,
        visible_state: {
          source: 'slack_context',
          symptomSeed: 'Report export hangs on large datasets',
          messageCount: 8,
          fileMessageCount: 2,
          screen: 'report export',
          ui: 'spinner active / unresponsive'
        },
        created_at: DEMO_CREATED_AT
      }
    ],
    diagnoses: [
      {
        id: 'diag_export_hang_01',
        symptom: 'Report export hangs on large datasets',
        role_lens: 'Translated CSM customer language into a reproducible frontend export failure.',
        evidence: [
          'Slack report names large report export as the failing workflow',
          'Recording shows stuck loading state after clicking Export',
          'Screenshot confirms the user remains on the export screen'
        ],
        created_at: '2026-06-06T20:01:40.000Z'
      }
    ],
    hypotheses: [
      {
        id: 'hyp_1_unbounded_export_query',
        title: 'Unbounded report query',
        confidence: 0.72,
        reproduction_plan: 'Seed a large dataset and trigger report export from the reporting page.',
        expected_failure: 'Export exceeds the synchronous row budget or spinner never resolves.',
        status: 'fixed'
      },
      {
        id: 'hyp_2_streaming_missing',
        title: 'Missing pagination or streaming on export',
        confidence: 0.58,
        reproduction_plan: 'Run export against a large fixture and inspect memory/response growth while the UI waits.',
        expected_failure: 'The response is built fully in memory before the browser receives a file.',
        status: 'pending'
      },
      {
        id: 'hyp_3_timeout_mismatch',
        title: 'Client/proxy timeout mismatch',
        confidence: 0.41,
        reproduction_plan: 'Compare frontend timeout, proxy timeout, and backend export processing time.',
        expected_failure: 'Backend continues work after the client has already timed out or stopped updating.',
        status: 'pending'
      }
    ],
    agentRuns: [
      {
        id: 'agent_run_export_hang_01',
        provider: 'scripted',
        status: 'shipped',
        logs_url: null,
        result: { failingCommand: 'npm run test:export-large:repro', passingCommand: 'npm run test:export-large:fixed' }
      }
    ],
    pullRequests: [
      {
        id: 'pr_export_hang_01',
        github_url: 'https://github.com/yxshrk/electron/pull/10',
        root_cause: 'Report export uses the unbounded synchronous export path for large datasets.',
        summary: 'Route the default export through the bounded batched exporter.',
        verification: 'Large export fixture completes under the demo timeout.'
      }
    ]
  };
}

/**
 * Creates a deterministic dashboard timeline event.
 *
 * @param eventType Stable event type.
 * @param status Run status after the event.
 * @param title Short title.
 * @param detail Event detail.
 * @param offsetSeconds Offset from demo start.
 * @returns Dashboard event row.
 * @sideEffects None.
 */
function event(
  eventType: string,
  status: string,
  title: string,
  detail: string,
  offsetSeconds: number
): DashboardRunEvent {
  return {
    id: `evt_${eventType}`,
    event_type: eventType,
    status,
    title,
    detail,
    created_at: new Date(Date.parse(DEMO_CREATED_AT) + offsetSeconds * 1000).toISOString()
  };
}

/**
 * Creates a deterministic dashboard media artifact.
 *
 * @param id Artifact ID.
 * @param kind Artifact type.
 * @param source Artifact source.
 * @param summary Human-readable summary.
 * @returns Dashboard media artifact row.
 * @sideEffects None.
 */
function artifact(
  id: string,
  kind: string,
  source: string,
  summary: string
): DashboardMediaArtifact {
  return {
    id,
    kind,
    source,
    storage_url: `insforge://reflex-evidence/runs/${DEMO_RUN_ID}/${id}`,
    summary
  };
}

/**
 * Converts unknown errors to concise strings for dashboard banners.
 *
 * @param error Unknown caught error.
 * @returns Error message.
 * @sideEffects None.
 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
