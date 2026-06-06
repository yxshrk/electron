import { dbSelect } from '@/lib/insforge/db';
import type { ReflexRunRow } from '@/lib/insforge/types';

export interface DashboardRun extends ReflexRunRow {
  summary?: string;
  media_count?: number;
  pr_url?: string | null;
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
  evidence?: unknown;
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
  summary: string | null;
  created_at?: string;
}

export interface DashboardBugBrief {
  id: string;
  where_it_happens: string;
  actual_behavior: string;
  expected_behavior: string | null;
  affected_surface: string;
  status: string;
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
}

export interface DashboardAgentRun {
  id: string;
  provider: string;
  status: string;
  logs_url: string | null;
  result: Record<string, unknown>;
}

export interface DashboardPullRequest {
  id: string;
  github_url: string;
  root_cause: string;
  summary: string;
  verification: string;
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
  diagnoses: DashboardDiagnosis[];
  hypotheses: DashboardHypothesis[];
  agentRuns: DashboardAgentRun[];
  pullRequests: DashboardPullRequest[];
}

const DEMO_CREATED_AT = '2026-06-06T20:00:00.000Z';
const DEMO_RUN_ID = 'run_export_hang_01';

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
  pr_url: 'https://github.com/yxshrk/electron/pull/10'
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
    return { source: 'insforge', runs };
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

    const [events, chatHistory, mediaArtifacts, bugBriefs, intakePackages, diagnoses, pullRequests] =
      await Promise.all([
        dbSelect<DashboardRunEvent>('run_events', `run_id=eq.${run.id}&order=created_at.asc&limit=200`),
        dbSelect<DashboardSlackMessage>('slack_context_messages', `run_id=eq.${run.id}&order=created_at.asc`),
        dbSelect<DashboardMediaArtifact>('media_artifacts', `run_id=eq.${run.id}&order=created_at.asc`),
        dbSelect<DashboardBugBrief>('bug_briefs', `run_id=eq.${run.id}&order=created_at.desc`),
        dbSelect<DashboardIntakePackage>('intake_packages', `run_id=eq.${run.id}&order=created_at.desc`),
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
        affected_surface: 'frontend',
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
    diagnoses: [
      {
        id: 'diag_export_hang_01',
        symptom: 'Report export hangs on large datasets',
        role_lens: 'Translated CSM customer language into a reproducible frontend export failure.'
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
