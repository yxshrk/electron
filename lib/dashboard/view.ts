export interface PipelineStage {
  status: string;
  label: string;
  detail: string;
}

export const PIPELINE_STAGES: PipelineStage[] = [
  { status: 'created', label: 'Intake', detail: 'Slack or recorder created a run' },
  { status: 'context_stored', label: 'Context', detail: 'Chat, media, or debug capture stored' },
  { status: 'report_drafted', label: 'Report', detail: 'Confirmable bug brief generated' },
  { status: 'package_confirmed', label: 'Confirmed', detail: 'User approved the intake package' },
  { status: 'diagnosed', label: 'Diagnosis', detail: 'Hypotheses ranked from the package' },
  { status: 'dispatched', label: 'Dispatch', detail: 'Agents started in sandboxes' },
  { status: 'reproduced', label: 'Repro', detail: 'Failure reproduced with evidence' },
  { status: 'fixed', label: 'Fix', detail: 'Patch written and verified' },
  { status: 'shipped', label: 'PR', detail: 'Pull request opened' }
];

/**
 * Converts raw pipeline statuses into dashboard display labels.
 *
 * @param status Raw run, hypothesis, or agent status.
 * @returns Human-readable status label.
 * @sideEffects None.
 */
export function statusLabel(status: string): string {
  return status.replace(/_/g, ' ');
}

/**
 * Chooses a visual tone for a status badge.
 *
 * @param status Raw run, hypothesis, or agent status.
 * @returns CSS tone class.
 * @sideEffects None.
 */
export function statusTone(status: string): string {
  if (status.includes('failed') || status === 'rejected') return 'bad';
  if (['shipped', 'fixed', 'reproduced', 'diagnosed', 'confirmed'].includes(status)) return 'good';
  if (
    ['created', 'context_stored', 'report_drafted', 'package_confirmed', 'dispatched', 'pending', 'running'].includes(status)
  ) {
    return 'info';
  }
  return 'warn';
}

/**
 * Formats an ISO timestamp for dashboard display.
 *
 * @param iso ISO timestamp.
 * @returns Locale timestamp or a dash when absent.
 * @sideEffects None.
 */
export function formatDate(iso?: string | null): string {
  return iso ? new Date(iso).toLocaleString() : '-';
}

/**
 * Serializes dashboard JSON in a stable, readable form.
 *
 * @param value JSON-ish dashboard value.
 * @returns Pretty-printed JSON.
 * @sideEffects None.
 */
export function prettyJson(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 2);
}

export interface EvidenceCountSource {
  chat_message_count?: number;
  media_count?: number;
  observation_count?: number;
}

export type DashboardRunFilter = 'all' | 'needs_confirmation' | 'diagnosed' | 'pr_opened' | 'failed';

export interface DashboardRunFilterOption {
  value: DashboardRunFilter;
  label: string;
}

export interface DashboardFilterSource {
  status: string;
  diagnosis_state?: 'not_started' | 'diagnosed';
  pr_url?: string | null;
  started_by?: string | null;
}

export const DASHBOARD_RUN_FILTERS: DashboardRunFilterOption[] = [
  { value: 'all', label: 'All' },
  { value: 'needs_confirmation', label: 'Needs confirmation' },
  { value: 'diagnosed', label: 'Diagnosed' },
  { value: 'pr_opened', label: 'PR opened' },
  { value: 'failed', label: 'Failed' },
];

/**
 * Counts all evidence-like items shown in the dashboard overview.
 *
 * @param source Run evidence counters from the dashboard read model.
 * @returns Total chat messages, media artifacts, and recorder observations.
 * @sideEffects None.
 */
export function evidenceTotalCount(source: EvidenceCountSource): number {
  return (source.chat_message_count ?? 0) + (source.media_count ?? 0) + (source.observation_count ?? 0);
}

/**
 * Formats a compact evidence summary for a run row.
 *
 * @param source Run evidence counters from the dashboard read model.
 * @returns Human-readable evidence count string.
 * @sideEffects None.
 */
export function evidenceLabel(source: EvidenceCountSource): string {
  const chat = source.chat_message_count ?? 0;
  const media = source.media_count ?? 0;
  const observations = source.observation_count ?? 0;
  if (chat === 0 && media === 0 && observations === 0) return '0';
  return `${chat} chat / ${media} media / ${observations} debug`;
}

/**
 * Formats the run starter for table display.
 *
 * @param actor Stored run actor, usually a Slack user ID.
 * @returns Compact owner label for the dashboard.
 * @sideEffects None.
 */
export function actorLabel(actor?: string | null): string {
  const value = actor?.trim();
  if (!value) return 'unknown';
  if (/^U[A-Z0-9]+$/i.test(value)) return `Slack ${value}`;
  return value;
}

/**
 * Parses a dashboard run filter query parameter.
 *
 * @param value Raw `view` search parameter.
 * @returns Supported filter value, defaulting to `all`.
 * @sideEffects None.
 */
export function parseDashboardRunFilter(value?: string | string[] | null): DashboardRunFilter {
  const raw = Array.isArray(value) ? value[0] : value;
  return DASHBOARD_RUN_FILTERS.some((filter) => filter.value === raw) ? (raw as DashboardRunFilter) : 'all';
}

/**
 * Filters dashboard runs for demo-focused queue views.
 *
 * @param runs Run rows from the dashboard read model.
 * @param filter Selected status filter.
 * @param owner Optional started-by actor filter.
 * @returns Runs matching the selected queue and owner filters.
 * @sideEffects None.
 */
export function filterDashboardRuns<T extends DashboardFilterSource>(
  runs: T[],
  filter: DashboardRunFilter,
  owner?: string | null
): T[] {
  const ownerValue = owner?.trim();
  return runs.filter((run) => {
    if (ownerValue && (run.started_by ?? '') !== ownerValue) return false;
    if (filter === 'all') return true;
    if (filter === 'needs_confirmation') return ['clarifying', 'report_drafted'].includes(run.status);
    if (filter === 'diagnosed') return run.status === 'diagnosed';
    if (filter === 'pr_opened') return Boolean(run.pr_url) || run.status === 'shipped';
    return run.status.includes('failed');
  });
}

/**
 * Returns distinct run owner values in first-seen order.
 *
 * @param runs Run rows from the dashboard read model.
 * @returns Non-empty owner actor IDs or names.
 * @sideEffects None.
 */
export function dashboardOwners(runs: DashboardFilterSource[]): string[] {
  const owners = new Set<string>();
  for (const run of runs) {
    const owner = run.started_by?.trim();
    if (owner) owners.add(owner);
  }
  return [...owners];
}

/**
 * Determines whether a pipeline stage is complete, active, or pending.
 *
 * @param currentStatus Current run status.
 * @param stageStatus Stage status to render.
 * @returns Stage visual state.
 * @sideEffects None.
 */
export function stageState(currentStatus: string, stageStatus: string): 'done' | 'active' | 'pending' | 'failed' {
  if (currentStatus.includes('failed')) return 'failed';
  const currentIndex = PIPELINE_STAGES.findIndex((stage) => stage.status === currentStatus);
  const stageIndex = PIPELINE_STAGES.findIndex((stage) => stage.status === stageStatus);
  if (currentIndex < 0 || stageIndex < 0) return 'pending';
  if (stageIndex < currentIndex) return 'done';
  if (stageIndex === currentIndex) return 'active';
  return 'pending';
}
