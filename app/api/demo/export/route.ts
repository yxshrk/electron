// Seeded-bug stand-in: a deliberately broken "report export" endpoint.
// Small datasets return fast; large ones simulate an unbounded query that loads every row
// synchronously, gets slow, and times out — the export-hang the demo narrates.
// Lets the recorder capture a REAL failing network call (url + status + duration) without
// needing the seeded repo to exist yet.
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const rows = Number(req.nextUrl.searchParams.get("rows") ?? "100");

  // "Unbounded query": time grows with row count (capped so we don't actually wedge the demo).
  const workMs = Math.min(rows / 12, 6000);
  await new Promise((r) => setTimeout(r, workMs));

  if (rows >= 10_000) {
    return NextResponse.json(
      {
        error: "Report export timed out: unbounded query loaded all rows into memory before streaming.",
        rows,
        elapsedMs: Math.round(workMs),
      },
      { status: 504 }
    );
  }
  return NextResponse.json({ ok: true, rows, elapsedMs: Math.round(workMs) });
}
