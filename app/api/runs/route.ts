// POST /api/runs   -> create a reflex_runs row (C1)
// GET  /api/runs   -> list runs (read-only dashboard)
import { NextRequest, NextResponse } from "next/server";
import { dbInsert, dbSelect } from "@/lib/insforge/db";
import { addEvent } from "@/lib/insforge/status";
import { shortKey } from "@/lib/ids";
import type { RunCreateInput, ReflexRunRow, Role, RunMode, RunSource } from "@/lib/insforge/types";

export const runtime = "nodejs";

const DEFAULT_REPO = process.env.DEFAULT_GITHUB_REPO ?? "https://github.com/yxshrk/electron";
const VALID_ROLES: Role[] = ["sales_csm", "ceo", "product", "engineer"];

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
    actor: source,
  });

  const origin = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;
  const recordingUrl = mode === "debug" ? `${origin}/debug/${run.id}` : undefined;

  return NextResponse.json({ runId: run.id, status: "created", recordingUrl });
}

export async function GET() {
  const runs = await dbSelect<ReflexRunRow>(
    "reflex_runs",
    "order=created_at.desc&limit=100"
  );
  return NextResponse.json({ runs });
}
