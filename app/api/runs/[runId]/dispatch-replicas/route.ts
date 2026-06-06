import { dispatchConfirmedHypothesis } from '../../../../../agent/replicas/dispatch';
import type { DispatchInput } from '../../../../../agent/replicas/types';

/**
 * Dispatches a confirmed Reflex hypothesis to Replicas or the scripted fallback.
 *
 * @param request HTTP request containing `DispatchInput` plus optional dispatch flags.
 * @param context Next.js route context containing `runId`.
 * @returns JSON response with dispatch result.
 * @sideEffects May start live Replicas work or scripted fallback work.
 */
export async function POST(
  request: Request,
  context: { params: { runId: string } }
): Promise<Response> {
  try {
    const body = (await request.json()) as DispatchInput & {
      createPr?: boolean;
      provider?: 'replicas' | 'scripted';
    };
    const input = normalizeDispatchInput(body, context.params.runId);
    const result = await dispatchConfirmedHypothesis(input, {
      createPr: body.createPr === true,
      preferScriptedFallback: body.provider === 'scripted'
    });

    return Response.json(result, { status: 202 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 }
    );
  }
}

/**
 * Validates and normalizes dispatch input from the route request body.
 *
 * @param body Raw dispatch request body.
 * @param routeRunId Run ID from the URL path.
 * @returns Normalized dispatch input.
 * @sideEffects None.
 */
function normalizeDispatchInput(body: DispatchInput, routeRunId: string): DispatchInput {
  if (body.runId !== routeRunId) {
    throw new Error(`Route runId ${routeRunId} does not match body runId ${body.runId}.`);
  }

  return body;
}
