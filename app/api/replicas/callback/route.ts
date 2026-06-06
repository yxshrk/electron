import type { EvidencePayload } from '../../../../agent/replicas/types';
import { persistEvidence } from '@/lib/insforge/evidence';

export const runtime = 'nodejs';

/**
 * Accepts Replicas or scripted fallback evidence callbacks and persists them.
 *
 * @param request HTTP request containing an evidence payload.
 * @returns JSON response confirming persistence.
 * @sideEffects Writes agent_runs + pull_requests and advances reflex_runs.status (Yash's layer).
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const payload = await request.json();
    const evidence = normalizeEvidencePayload(payload);
    const persisted = await persistEvidence(evidence);

    return Response.json(
      {
        status: 'accepted',
        evidence,
        persistence: 'persisted',
        ...persisted
      },
      { status: 202 }
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 }
    );
  }
}

/**
 * Normalizes provider callback payloads into the shared `EvidencePayload` contract.
 *
 * @param payload Raw provider callback payload.
 * @returns Evidence payload consumed by the backend persistence layer.
 * @sideEffects None.
 */
function normalizeEvidencePayload(payload: unknown): EvidencePayload {
  const candidate = payload as Partial<EvidencePayload>;

  if (!candidate.runId || !candidate.hypothesisId || !candidate.status) {
    throw new Error('Evidence callback requires runId, hypothesisId, and status.');
  }

  return {
    runId: candidate.runId,
    hypothesisId: candidate.hypothesisId,
    status: candidate.status,
    rootCause: candidate.rootCause ?? '',
    fixSummary: candidate.fixSummary ?? '',
    verification: candidate.verification ?? '',
    logsUrl: candidate.logsUrl,
    prUrl: candidate.prUrl,
    provider: candidate.provider ?? 'replicas'
  };
}
