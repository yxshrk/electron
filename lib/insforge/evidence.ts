// Persist Replicas/scripted evidence (Luke deferred this to Yash's InsForge layer).
// Writes an agent_runs row, a pull_requests row when a PR exists, and advances the run status
// to reproduced / fixed / shipped (or a failure state) so the PR + final status reach Slack + the
// dashboard. Called from /dispatch (inline scripted evidence) and /replicas/callback (live path).
import { dbInsert } from "./db";
import { setStatus } from "./status";
import type { EvidencePayload, RunEventInput, RunStatus } from "./types";

// EvidencePayload.status values are all valid run statuses.
const RUN_STATUS: Record<EvidencePayload["status"], RunStatus> = {
  reproduced: "reproduced",
  fixed: "fixed",
  shipped: "shipped",
  reproduction_failed: "reproduction_failed",
  pr_failed: "pr_failed",
};

function title(e: EvidencePayload): string {
  switch (e.status) {
    case "shipped":
      return e.prUrl ? "PR opened — fix shipped" : "Fix shipped";
    case "fixed":
      return "Fix verified in sandbox";
    case "reproduced":
      return "Bug reproduced in sandbox";
    case "reproduction_failed":
      return "Reproduction failed";
    case "pr_failed":
      return "PR creation failed";
  }
}

export interface PersistedEvidence {
  agentRunId: string;
  pullRequestId?: string;
}

interface EvidenceTimelineEvent {
  status: RunStatus;
  event: Omit<RunEventInput, "status">;
}

/**
 * Persists one agent evidence payload and advances the Reflex run timeline.
 *
 * @param evidence Evidence produced by Replicas or the scripted fallback.
 * @returns IDs for the persisted agent run and optional pull request row.
 * @sideEffects Inserts `agent_runs`, optionally inserts `pull_requests`, and writes run status events.
 */
export async function persistEvidence(evidence: EvidencePayload): Promise<PersistedEvidence> {
  // 1. agent_runs — the run that produced this evidence.
  const agentRun = await dbInsert<{ id: string }>("agent_runs", {
    hypothesis_id: evidence.hypothesisId,
    provider: evidence.provider,
    status: evidence.status,
    logs_url: evidence.logsUrl ?? null,
    result: evidence,
    completed_at: new Date().toISOString(),
  });

  // 2. pull_requests — only when a PR was actually opened.
  let pullRequestId: string | undefined;
  if (evidence.prUrl) {
    const pr = await dbInsert<{ id: string }>("pull_requests", {
      run_id: evidence.runId,
      agent_run_id: agentRun.id,
      github_url: evidence.prUrl,
      root_cause: evidence.rootCause,
      summary: evidence.fixSummary,
      verification: evidence.verification,
    });
    pullRequestId = pr.id;
  }

  // 3. advance the run status (this is what surfaces proof + PR in Slack/dashboard).
  for (const milestone of buildEvidenceTimelineEvents(evidence, agentRun.id)) {
    await setStatus(evidence.runId, milestone.status, milestone.event);
  }

  return { agentRunId: agentRun.id, pullRequestId };
}

/**
 * Builds the ordered timeline milestones implied by an evidence payload.
 *
 * @param evidence Evidence produced by Replicas or the scripted fallback.
 * @param agentRunId Persisted `agent_runs` row ID.
 * @returns Ordered status events that should be appended to the run timeline.
 * @sideEffects None.
 */
export function buildEvidenceTimelineEvents(
  evidence: EvidencePayload,
  agentRunId: string
): EvidenceTimelineEvent[] {
  const events: EvidenceTimelineEvent[] = [];
  const payload = evidencePayload(evidence, agentRunId);

  if (["reproduced", "fixed", "shipped", "pr_failed"].includes(evidence.status)) {
    events.push({
      status: "reproduced",
      event: {
        eventType: "bug.reproduced",
        title: "Bug reproduced in sandbox",
        detail: evidence.rootCause || evidence.verification || "",
        payload,
        actor: "replicas",
      },
    });
  }

  if (["fixed", "shipped", "pr_failed"].includes(evidence.status)) {
    events.push({
      status: "fixed",
      event: {
        eventType: "fix.verified",
        title: "Fix written + tested",
        detail: evidence.verification || evidence.fixSummary || "",
        payload,
        actor: "replicas",
      },
    });
  }

  if (evidence.status === "shipped") {
    events.push({
      status: "shipped",
      event: {
        eventType: evidence.prUrl ? "pr.opened" : "evidence.shipped",
        title: title(evidence),
        detail: evidence.fixSummary || evidence.rootCause || evidence.verification || "",
        payload,
        actor: "replicas",
      },
    });
  }

  if (evidence.status === "reproduction_failed" || evidence.status === "pr_failed") {
    events.push({
      status: RUN_STATUS[evidence.status],
      event: {
        eventType: evidence.status === "pr_failed" ? "pr.failed" : "bug.reproduction_failed",
        title: title(evidence),
        detail: evidence.fixSummary || evidence.rootCause || evidence.verification || "",
        payload,
        actor: "replicas",
      },
    });
  }

  return events;
}

/**
 * Builds the shared payload attached to evidence timeline events.
 *
 * @param evidence Evidence produced by Replicas or the scripted fallback.
 * @param agentRunId Persisted `agent_runs` row ID.
 * @returns Run event payload consumed by Slack and the dashboard.
 * @sideEffects None.
 */
function evidencePayload(evidence: EvidencePayload, agentRunId: string): Record<string, unknown> {
  return {
    prUrl: evidence.prUrl,
    provider: evidence.provider,
    agentRunId,
    rootCause: evidence.rootCause,
    verification: evidence.verification,
  };
}
