// GET /api/runs/{runId}/events -> Server-Sent Events stream of run_events (C6).
// Slack and the dashboard subscribe here for the live pipeline timeline. Vercel = SSE, not WS
// (STACK_RESEARCH §5). Falls back gracefully: clients can also poll GET /api/runs/{runId}.
import { NextRequest } from "next/server";
import { dbSelect } from "@/lib/insforge/db";

export const runtime = "nodejs";
export const maxDuration = 120;

interface RunEventRow {
  id: string;
  event_type: string;
  status: string | null;
  title: string;
  detail: string;
  payload: Record<string, unknown>;
  created_at: string;
}

const TERMINAL = new Set(["shipped", "diagnosis_failed", "dispatch_failed", "reproduction_failed", "pr_failed"]);

export async function GET(_req: NextRequest, { params }: { params: { runId: string } }) {
  const { runId } = params;
  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

      const seen = new Set<string>();
      const poll = async () => {
        const rows = await dbSelect<RunEventRow>(
          "run_events",
          `run_id=eq.${runId}&order=created_at.asc&limit=200`
        );
        for (const row of rows) {
          if (seen.has(row.id)) continue;
          seen.add(row.id);
          send("run-event", {
            runId,
            eventType: row.event_type,
            status: row.status,
            title: row.title,
            detail: row.detail,
            payload: row.payload,
            createdAt: row.created_at,
          });
          if (row.status && TERMINAL.has(row.status)) return true;
        }
        return false;
      };

      try {
        let done = await poll();
        // ~2 minutes of polling at 1.5s, then close (client can reconnect/poll).
        for (let i = 0; i < 75 && !done && !closed; i++) {
          await new Promise((r) => setTimeout(r, 1500));
          done = await poll();
        }
      } catch (e) {
        send("error", { message: String(e) });
      } finally {
        send("done", { runId });
        controller.close();
      }
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
