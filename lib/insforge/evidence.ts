// Persist Replicas/scripted evidence (Luke deferred this to Yash's InsForge layer).
// Writes an agent_runs row, a pull_requests row when a PR exists, and advances the run status
// to reproduced / fixed / shipped (or a failure state) so the PR + final status reach Slack + the
// dashboard. Called from /dispatch (inline scripted evidence) and /replicas/callback (live path).
import { dbInsert } from "./db";
import { setStatus } from "./status";
import type { EvidencePayload, RunStatus } from "./types";

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

  // 3. advance the run status (this is what surfaces the PR + final state in Slack/dashboard).
  await setStatus(evidence.runId, RUN_STATUS[evidence.status], {
    eventType: `evidence.${evidence.status}`,
    title: title(evidence),
    detail: evidence.fixSummary || evidence.rootCause || evidence.verification || "",
    payload: {
      prUrl: evidence.prUrl,
      provider: evidence.provider,
      agentRunId: agentRun.id,
      rootCause: evidence.rootCause,
      verification: evidence.verification,
    },
    actor: "replicas",
  });

  return { agentRunId: agentRun.id, pullRequestId };
}
