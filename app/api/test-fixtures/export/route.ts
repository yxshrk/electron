// TEST FIXTURE — not part of the product.
// A deliberately broken "report export" endpoint so we can exercise the Reflex recorder against a
// real, reproducible bug. It does NOT contain the bug itself — it calls the SAME seeded module that
// Reflex grounds the diagnosis in and that the fix patches: app/test-fixtures/reports/export.ts.
// Small datasets return fast; large ones blow the synchronous row budget of
// exportReportCsvUnbounded() and 504. The whole buggy app — UI, this endpoint's logic, and the
// fixable module — lives under app/test-fixtures/, which is the exact subtree grounding greps and
// the fix patches. One bug, one source of truth: grounded file == fixed file (no demo seam).
import { NextRequest, NextResponse } from "next/server";
import { createLargeReportFixture } from "@/app/test-fixtures/reports/report-fixture";
import { exportReportCsv } from "@/app/test-fixtures/reports/export";

export const runtime = "nodejs";
export const maxDuration = 30;

// Above this row count the unbounded synchronous exporter gives up. Matches the seeded bug's budget
// in app/test-fixtures/reports/export.ts; the known fix routes large exports through the batched exporter instead.
const SYNCHRONOUS_ROW_BUDGET = 10_000;

export async function GET(req: NextRequest) {
  const rows = Number(req.nextUrl.searchParams.get("rows") ?? "100");

  // Simulate the unbounded synchronous load: wall-clock grows with row count (caps at 6s) so the
  // recorder captures a visible hang before the failure — the "export was slow then 504'd" timeline.
  const workMs = Math.min(rows / 12, 6000);
  await new Promise((r) => setTimeout(r, workMs));

  const records = createLargeReportFixture(rows);
  try {
    // Real product path: exportReportCsv -> exportReportCsvUnbounded (the seeded bug). Large datasets
    // throw "exceeded the synchronous row budget"; the fix swaps this to the batched exporter.
    const csv = exportReportCsv(records, { maxSynchronousRows: SYNCHRONOUS_ROW_BUDGET });
    return NextResponse.json({ ok: true, rows, bytes: csv.length, elapsedMs: Math.round(workMs) });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      {
        error: `Report export timed out: ${detail} Unbounded query loaded all rows into memory before streaming.`,
        rows,
        elapsedMs: Math.round(workMs),
      },
      { status: 504 }
    );
  }
}
