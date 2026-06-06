// POST /api/slack/interactions - Confirm / Edit Report / Add Attachment + modal submit.
// Slack sends application/x-www-form-urlencoded with a `payload` JSON field; ack within 3s.

import { verifySlackRequest } from '../../../../lib/slack/verify';
import { openModal, postMessage } from '../../../../lib/slack/client';
import { editModal } from '../../../../lib/slack/blocks';
import { confirmBugBrief, dispatch, getDraft } from '../../../../lib/slack/backend';
import type { ConfirmInput } from '../../../../lib/slack/contracts';

export const runtime = 'nodejs';

/**
 * Handles Slack block actions and edit modal submissions.
 *
 * @param req Slack interaction request.
 * @returns Empty Slack acknowledgement response.
 * @sideEffects Verifies Slack signature, may open a modal, post a message, or start confirmation.
 */
export async function POST(req: Request): Promise<Response> {
  const rawBody = await req.text();
  if (!verifySlackRequest({
    signingSecret: process.env.SLACK_SIGNING_SECRET ?? '',
    signature: req.headers.get('x-slack-signature'),
    timestamp: req.headers.get('x-slack-request-timestamp'),
    rawBody,
  })) {
    return new Response('invalid signature', { status: 401 });
  }

  const form = new URLSearchParams(rawBody);
  const payload = JSON.parse(form.get('payload') ?? '{}');

  if (payload.type === 'block_actions') {
    const action = payload.actions?.[0];
    const runId: string = action?.value;
    const channel = payload.channel?.id;
    const threadTs = payload.message?.thread_ts ?? payload.message?.ts;

    switch (action?.action_id) {
      case 'reflex_confirm':
        confirmInBackground(runId); // package_confirmed -> diagnosed; status thread animates via events
        return new Response('', { status: 200 });

      case 'reflex_dispatch': // Gate 2: approve the diagnosis -> dispatch fix -> PR
        dispatchInBackground(runId);
        return new Response('', { status: 200 });

      case 'reflex_edit': {
        const draft = await getDraft(runId);
        if (draft) await openModal(payload.trigger_id, editModal(runId, draft));
        return new Response('', { status: 200 });
      }

      case 'reflex_add_attachment':
        if (channel) {
          await postMessage({
            channel, thread_ts: threadTs, text: 'Add an attachment',
            blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'Upload a screenshot or recording *in this thread* and I will fold it into the report.' } }],
          });
        }
        return new Response('', { status: 200 });

      case 'reflex_open_recorder': // URL button - Slack opens it; nothing to do server-side
        return new Response('', { status: 200 });
    }
  }

  // Edit modal submitted -> send edited fields to the same confirmation route (section 8 editedFields).
  if (payload.type === 'view_submission' && payload.view?.callback_id === 'reflex_edit_submit') {
    const runId: string = payload.view.private_metadata;
    const v = payload.view.state?.values ?? {};
    const editedFields = {
      whereItHappens: v.where_block?.where_input?.value ?? '',
      actualBehavior: v.actual_block?.actual_input?.value ?? '',
      expectedBehavior: v.expected_block?.expected_input?.value ?? '',
    };
    confirmInBackground(runId, { editedFields, confirmedBy: payload.user?.id });
    return new Response('', { status: 200 }); // closes the modal
  }

  return new Response('', { status: 200 });
}

/**
 * Starts report confirmation without blocking Slack's three-second acknowledgement window.
 *
 * @param runId Reflex run ID.
 * @param input Optional edited fields and confirmation metadata.
 * @returns Nothing.
 * @sideEffects Calls Yash's confirm and diagnose APIs in the background.
 */
function confirmInBackground(runId: string, input: ConfirmInput = {}): void {
  void confirmBugBrief(runId, input).catch((error) => {
    console.error('Reflex confirmation failed', error);
  });
}

/**
 * Fires Gate-2 dispatch without blocking Slack's three-second acknowledgement window.
 *
 * @param runId Reflex run ID.
 * @returns Nothing.
 * @sideEffects Calls Yash's /dispatch orchestrator (→ Replicas / scripted fallback → PR).
 */
function dispatchInBackground(runId: string): void {
  void dispatch(runId, { createPr: true }).catch((error) => {
    console.error('Reflex dispatch failed', error);
  });
}
