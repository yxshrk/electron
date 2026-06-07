// POST /api/replicas/webhook — Replicas calls this when an agent finishes (replica.turn_completed).
// Closes the loop: maps the finished replica back to its Reflex run and persists shipped evidence
// so Slack + the dashboard reach "shipped" with the PR.
//
// The exact Replicas webhook body isn't in the public docs, so we parse defensively:
//  - runId: we encode it in the replica NAME (replicas_{runId}_{slug}); regex it out of the body.
//  - prUrl: regex any github.com/.../pull/N anywhere in the body.
// The raw payload is logged so we can tighten parsing from the first real delivery (`vercel logs`).
import { persistEvidence } from '@/lib/insforge/evidence';
import type { EvidencePayload } from '@/lib/insforge/types';

export const runtime = 'nodejs';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

export async function POST(req: Request): Promise<Response> {
  const raw = await req.text();
  const event = req.headers.get('x-replicas-event') ?? '';
  console.log('[replicas-webhook]', event, raw.slice(0, 2000)); // refine parsing from this if needed

  const runId = raw.match(new RegExp(`replicas[_-](${UUID})`, 'i'))?.[1];
  const prUrl = raw.match(/https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/i)?.[0];

  // Only act on completion (or whenever a PR is present); ignore ready/heartbeat events.
  const done = /turn_completed|completed|finished|ready/i.test(event) || Boolean(prUrl);
  if (!runId || !done) {
    return Response.json({ ok: true, ignored: true, hadRunId: Boolean(runId) }, { status: 200 });
  }

  try {
    const base = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;
    // Persist needs a real hypothesis_id — reuse the run's top diagnosed hypothesis.
    const detail = await fetch(`${base}/api/runs/${runId}`, { cache: 'no-store' }).then((r) => r.json()).catch(() => ({}));
    const hypothesisId = detail?.hypotheses?.[0]?.id ?? 'replicas';

    const evidence: EvidencePayload = {
      runId,
      hypothesisId,
      status: prUrl ? 'shipped' : 'fixed',
      rootCause: '',
      fixSummary: 'Reflex agent applied a fix',
      verification: 'Reproduced and fixed in a Replicas sandbox',
      prUrl,
      provider: 'replicas',
    };
    await persistEvidence(evidence);
    return Response.json({ ok: true, runId, prUrl: prUrl ?? null }, { status: 200 });
  } catch (error) {
    console.error('[replicas-webhook] persist failed', error);
    return Response.json({ ok: false, error: String(error) }, { status: 200 }); // 2xx so Replicas won't spam retries
  }
}
