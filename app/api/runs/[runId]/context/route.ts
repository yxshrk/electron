// POST /api/runs/{runId}/context -> store copied Slack context candidates (Laurence's bug mode).
// Owned by Yash (the ingest contract); Laurence calls it. Kept light here - the debug path is the
// focus of this branch, but the route exists so both entry points converge on the same flow.
import { NextRequest, NextResponse } from "next/server";
import { dbInsert, getRun } from "@/lib/insforge/db";
import { setStatus } from "@/lib/insforge/status";
import { buildSlackObservation } from "@/lib/slack/observation";
import type { ReflexRunRow } from "@/lib/insforge/types";

export const runtime = "nodejs";

interface SlackMessage {
  ts: string;
  userId?: string;
  text?: string;
  permalink?: string;
  hasFiles?: boolean;
  raw?: Record<string, unknown>;
}

/**
 * Stores Slack context and mirrors it into an observation for report drafting.
 *
 * @param req Request containing `{ messages }` copied from Slack.
 * @param params Dynamic route params containing the run ID.
 * @returns JSON count of stored messages and status.
 * @sideEffects Inserts Slack messages, inserts an observation, and appends a run event in InsForge.
 */
export async function POST(req: NextRequest, { params }: { params: { runId: string } }) {
  const { runId } = params;
  const run = await getRun<ReflexRunRow>(runId);
  if (!run) return NextResponse.json({ error: "run not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { messages?: SlackMessage[] };
  const messages = body.messages ?? [];

  for (const m of messages) {
    await dbInsert("slack_context_messages", {
      run_id: runId,
      slack_message_ts: m.ts,
      slack_user_id: m.userId ?? null,
      text: m.text ?? "",
      permalink: m.permalink ?? null,
      has_files: Boolean(m.hasFiles),
      raw_payload: m.raw ?? {},
    });
  }

  const observation = buildSlackObservation(run, messages);
  if (observation.transcript) {
    await dbInsert("observations", {
      run_id: runId,
      transcript: observation.transcript,
      visible_state: observation.visibleState,
    });
  }

  await setStatus(runId, "context_stored", {
    eventType: "context.stored",
    title: "Slack context stored",
    detail: `${messages.length} message(s) copied`,
    payload: { storedMessages: messages.length },
    actor: "slack",
  });

  return NextResponse.json({ storedMessages: messages.length, status: "stored" });
}
