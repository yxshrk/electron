import type { EvidencePayload } from '../../../../agent/replicas/types';

/**
 * Accepts Replicas or scripted fallback evidence callbacks.
 *
 * @param request HTTP request containing an evidence payload.
 * @returns JSON response with normalized evidence for Yash's persistence layer.
 * @sideEffects None in this Luke-owned stub; persistence is wired by Yash's InsForge layer.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const payload = await request.json();
    const evidence = normalizeEvidencePayload(payload);

    return Response.json(
      {
        status: 'accepted',
        evidence,
        persistence: 'pending_insforge_integration'
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
