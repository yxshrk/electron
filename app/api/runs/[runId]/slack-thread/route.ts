// POST /api/runs/{runId}/slack-thread
// Persists the Slack channel + thread-root timestamp for a run so the server can push the
// Confirm / Approve-&-dispatch / PR cards straight into the thread (lib/slack/push), independent of
// the in-process mirror poll. Called by the slash routes right after they post the thread's root
// message — that root message's ts is the thread the cards reply into.
import { NextRequest, NextResponse } from "next/server";
import { dbUpdate } from "@/lib/insforge/db";

export const runtime = "nodejs";

/**
 * Stores the Slack channel and thread root for a run.
 *
 * @param req Request body containing `channel` and `threadTs`.
 * @param params Route params containing the Reflex run ID.
 * @returns JSON acknowledgement, or a 400 when the thread timestamp is missing.
 * @sideEffects Updates the reflex_runs row's slack_channel_id / slack_thread_ts.
 */
export async function POST(req: NextRequest, { params }: { params: { runId: string } }) {
  const { runId } = params;
  const body = (await req.json().catch(() => ({}))) as { channel?: string; threadTs?: string };
  if (!body.threadTs) {
    return NextResponse.json({ error: "threadTs required" }, { status: 400 });
  }
  const patch: Record<string, unknown> = { slack_thread_ts: body.threadTs };
  if (body.channel) patch.slack_channel_id = body.channel;
  await dbUpdate("reflex_runs", `id=eq.${runId}`, patch);
  return NextResponse.json({ ok: true });
}
