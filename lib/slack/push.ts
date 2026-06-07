// Server-side push of the actionable Slack cards (Confirm / Approve-&-dispatch / PR) at the moment
// a run's status changes. This is the robust replacement for the in-process mirror poll on the
// cards the poll actually drops:
//   - `diagnosed` — the poll often dies right after `package_confirmed` (Next dev teardown, or a
//     recompile), so the Gate-2 "Approve & dispatch" card never posts.
//   - `shipped`   — the Replicas webhook persists evidence minutes later, long after the poll's
//     maxDuration (5 min) has elapsed, so the PR card never posts.
//
// Because this runs from setStatus, each card is posted inside the SAME awaited request that
// advanced the status (confirm→diagnose, or webhook→persistEvidence) — it can't be orphaned by a
// separate background loop dying.
//
// Dedup: post only on the FIRST event of a given status (the recorder can double-fire
// report_drafted; Replicas can re-deliver a webhook). The mirror poll no longer posts these cards,
// so this is the single source of truth for them.
import { dbSelect, getRun } from "@/lib/insforge/db";
import { postMessage } from "@/lib/slack/client";
import { dispatchPromptBlocks, prCardBlocks, reportBlocks } from "@/lib/slack/blocks";
import type { ReportDraft } from "@/lib/slack/contracts";
import type { BugBriefRow, ReflexRunRow, RunEventInput, RunStatus } from "@/lib/insforge/types";

const GATE_STATUSES = new Set<RunStatus>(["report_drafted", "diagnosed", "shipped"]);

interface DiagnosedPayload {
  symptom?: string;
  hypotheses?: Array<{ title: string; confidence?: number }>;
}

/**
 * Posts the actionable Slack card for a run status transition, straight into the run's thread.
 *
 * @param runId Reflex run ID.
 * @param status The status just written by setStatus.
 * @param event The timeline event for this transition (carries the diagnosis / PR payload).
 * @returns Nothing; a no-op for non-gate statuses, non-Slack runs, or already-posted cards.
 * @sideEffects Reads the run + run_events and may post one Slack message.
 */
export async function pushGateCard(
  runId: string,
  status: RunStatus,
  event: Omit<RunEventInput, "status">
): Promise<void> {
  if (!GATE_STATUSES.has(status)) return;
  if (!process.env.SLACK_BOT_TOKEN) return; // Slack not configured (local web-only runs)

  const run = await getRun<ReflexRunRow>(runId);
  if (!run?.slack_channel_id) return; // not a Slack run (e.g. web/dashboard intake)

  // Bug mode posts its own Confirm card directly in /reflex-report (with the channel-context line);
  // only the recorder (debug) path relies on us to push it.
  if (status === "report_drafted" && run.mode !== "debug") return;

  // Dedup: setStatus has already written the current event, so exactly one row == first occurrence;
  // more than one means we already posted this card on an earlier identical transition.
  const priors = await dbSelect<{ id: string }>(
    "run_events",
    `run_id=eq.${runId}&status=eq.${status}&select=id`
  );
  if (priors.length > 1) return;

  // Reply into the run's thread when we have its root; if thread persistence failed, fall back to a
  // top-level channel post so the actionable card is still delivered (never silently dropped).
  const target: { channel: string; thread_ts?: string } = run.slack_thread_ts
    ? { channel: run.slack_channel_id, thread_ts: run.slack_thread_ts }
    : { channel: run.slack_channel_id };

  if (status === "report_drafted") {
    const draft = await loadDraft(runId);
    if (draft) {
      await postMessage({
        ...target,
        text: "Confirm the bug report",
        blocks: reportBlocks(draft, "Captured live via the Reflex recorder"),
      });
    }
    return;
  }

  if (status === "diagnosed") {
    const payload = (event.payload ?? {}) as DiagnosedPayload;
    await postMessage({
      ...target,
      text: "Diagnosis ready — approve the fix?",
      blocks: dispatchPromptBlocks(runId, {
        symptom: payload.symptom,
        hypotheses: payload.hypotheses ?? [],
      }),
    });
    return;
  }

  if (status === "shipped") {
    const prUrl = (event.payload as { prUrl?: string } | undefined)?.prUrl;
    if (prUrl) {
      await postMessage({ ...target, text: "PR opened", blocks: prCardBlocks(prUrl, event.detail) });
    }
  }
}

/**
 * Loads the latest bug brief and shapes it as the Slack ReportDraft for the Confirm card.
 *
 * @param runId Reflex run ID.
 * @returns The report draft, or null when no brief exists.
 * @sideEffects Reads bug_briefs from InsForge.
 */
async function loadDraft(runId: string): Promise<ReportDraft | null> {
  const rows = await dbSelect<BugBriefRow>(
    "bug_briefs",
    `run_id=eq.${runId}&order=created_at.desc&limit=1`
  );
  const brief = rows[0];
  if (!brief) return null;
  return {
    runId,
    bugBriefId: brief.id,
    status: "needs_confirmation",
    whereItHappens: brief.where_it_happens,
    actualBehavior: brief.actual_behavior,
    expectedBehavior: brief.expected_behavior ?? undefined,
    reproductionContext: brief.reproduction_context ?? undefined,
    affectedSurface: brief.affected_surface as ReportDraft["affectedSurface"],
    evidenceSummary: brief.evidence_summary ?? [],
    missingInfo: brief.missing_info ?? [],
    agentPromptPreview: brief.agent_prompt_preview,
  };
}
