// POST /api/slack/interactions  — Block Kit actions (Phase L3): Confirm / Edit / modal submit.
// Slack sends application/x-www-form-urlencoded with a `payload` JSON field; ack within 3s.

import { verifySlackRequest } from '../../../../lib/slack/verify';
import { openModal } from '../../../../lib/slack/client';
import { editModal } from '../../../../lib/slack/blocks';
import { confirm, rediagnose } from '../../../../lib/slack/backend';
import { getBrief } from '../../../../lib/slack/__mocks__/reflex-backend';

export const runtime = 'nodejs';

export async function POST(req: Request): Promise<Response> {
  const rawBody = await req.text();

  if (
    !verifySlackRequest({
      signingSecret: process.env.SLACK_SIGNING_SECRET ?? '',
      signature: req.headers.get('x-slack-signature'),
      timestamp: req.headers.get('x-slack-request-timestamp'),
      rawBody,
    })
  ) {
    return new Response('invalid signature', { status: 401 });
  }

  const form = new URLSearchParams(rawBody);
  const payload = JSON.parse(form.get('payload') ?? '{}');

  // Button clicks (Confirm / Edit).
  if (payload.type === 'block_actions') {
    const action = payload.actions?.[0];
    const sessionId: string = action?.value;

    if (action?.action_id === 'reflex_confirm') {
      void confirm(sessionId); // Yash flips to confirmed → Luke dispatches; thread animates via L4
      return new Response('', { status: 200 });
    }

    if (action?.action_id === 'reflex_edit') {
      const brief = getBrief(sessionId);
      await openModal(payload.trigger_id, editModal(sessionId, brief?.symptom ?? ''));
      return new Response('', { status: 200 });
    }
  }

  // Edit modal submitted → re-diagnose with the user's wording.
  if (payload.type === 'view_submission' && payload.view?.callback_id === 'reflex_edit_submit') {
    const sessionId: string = payload.view.private_metadata;
    const symptom: string =
      payload.view.state?.values?.symptom_block?.symptom_input?.value ?? '';
    void rediagnose(sessionId, symptom);
    // Closing the modal; the regenerated brief card will be posted via the status stream (L4).
    return new Response('', { status: 200 });
  }

  return new Response('', { status: 200 });
}
