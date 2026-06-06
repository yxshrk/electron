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
