// POST /api/runs   -> create a reflex_runs row (C1)
// GET  /api/runs   -> list runs (read-only dashboard)
import { NextRequest, NextResponse } from "next/server";
import { dbInsert } from "@/lib/insforge/db";
import { getDashboardRuns } from "@/lib/dashboard/read-model";
import { addEvent } from "@/lib/insforge/status";
import { shortKey } from "@/lib/ids";
import type { RunCreateInput, ReflexRunRow, Role, RunMode, RunSource } from "@/lib/insforge/types";

export const runtime = "nodejs";

const DEFAULT_REPO = process.env.DEFAULT_GITHUB_REPO ?? "https://github.com/yxshrk/electron";
const VALID_ROLES: Role[] = ["sales_csm", "ceo", "product", "engineer"];

/**
 * Creates a Reflex run in InsForge from a Slack or web intake request.
 *
 * @param req Incoming request containing a partial run creation payload.
 * @returns JSON with the created run ID, status, and optional debug recording URL.
 * @sideEffects Inserts a reflex_runs row and emits the initial run.created event.
 */
export async function POST(req: NextRequest) {
  let body: Partial<RunCreateInput>;
  try {
    body = (await req.json()) as Partial<RunCreateInput>;
  } catch {
    body = {};
  }

  const mode: RunMode = body.mode === "debug" ? "debug" : "bug";
  const source: RunSource = body.source ?? "web";
  const role: Role = VALID_ROLES.includes(body.role as Role) ? (body.role as Role) : "sales_csm";
  const repoUrl = body.repoUrl || DEFAULT_REPO;
  const contextWindow = body.contextWindow ?? {
    messageLimit: 100,
    attachments: 3,
    maxPromptChars: 6000,
  };
  const actor = runActor(body.slackUserId, source);

  const run = await dbInsert<ReflexRunRow>("reflex_runs", {
    run_key: shortKey("run"),
    source,
    mode,
    role,
    repo_url: repoUrl,
    command_text: body.commandText ?? "",
    slack_channel_id: body.slackChannelId ?? null,
    slack_thread_ts: body.slackThreadTs ?? null,
    context_window: contextWindow,
    status: "created",
  });

  await addEvent(run.id, {
    eventType: "run.created",
    status: "created",
    title: `Run created (${mode} mode)`,
    detail: `role=${role} repo=${repoUrl}`,
    actor,
  });

  const origin = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;
  const recordingUrl = mode === "debug" ? `${origin}/debug/${run.id}` : undefined;

  return NextResponse.json({ runId: run.id, status: "created", recordingUrl });
}

/**
 * Lists dashboard runs from InsForge, or fixture data when backend setup is absent.
 *
 * @returns JSON dashboard run list with source metadata.
 * @sideEffects Reads from InsForge when credentials are configured.
 */
export async function GET() {
  return NextResponse.json(await getDashboardRuns());
}

/**
 * Chooses the actor recorded on the initial run event.
 *
 * @param slackUserId Slack slash-command user ID when the run came from Slack.
 * @param source Run source used as the fallback actor.
 * @returns Stable actor string for timeline and dashboard ownership.
 * @sideEffects None.
 */
function runActor(slackUserId: string | undefined, source: RunSource): string {
  const trimmed = slackUserId?.trim();
  return trimmed || source;
}
