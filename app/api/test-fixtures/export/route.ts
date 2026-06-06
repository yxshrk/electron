// TEST FIXTURE — not part of the product.
// A deliberately broken "report export" endpoint so we can exercise the Reflex recorder against a
// real, reproducible bug. Small datasets return fast; large ones simulate an unbounded query that
// loads every row synchronously, gets slow, and times out (504) — the export-hang the demo narrates.
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const rows = Number(req.nextUrl.searchParams.get("rows") ?? "100");
  const workMs = Math.min(rows / 12, 6000); // "unbounded query": time grows with row count
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
