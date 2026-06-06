// State-machine helpers. Every status change writes reflex_runs.status AND appends a
// run_events row so Slack + the dashboard render a full timeline (shared-contracts §2, C6).
import { dbInsert, dbUpdate } from "./db";
import type { RunStatus, RunEventInput } from "./types";

const TERMINAL: RunStatus[] = ["shipped"];

/** Append a timeline event without changing run status. */
export async function addEvent(runId: string, event: RunEventInput): Promise<void> {
  await dbInsert("run_events", {
    run_id: runId,
    event_type: event.eventType,
    status: event.status ?? null,
    title: event.title,
    detail: event.detail ?? "",
    payload: event.payload ?? {},
    actor: event.actor ?? "yash-backend",
  });
}

/** Transition a run to `status` and record the event. */
export async function setStatus(
  runId: string,
  status: RunStatus,
  event: Omit<RunEventInput, "status">
): Promise<void> {
  const patch: Record<string, unknown> = { status };
  if (TERMINAL.includes(status)) patch.completed_at = new Date().toISOString();
  await dbUpdate("reflex_runs", `id=eq.${runId}`, patch);
  await addEvent(runId, { ...event, status });
}
