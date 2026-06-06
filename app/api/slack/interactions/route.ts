// POST /api/slack/interactions — Confirm / Edit Report / Add Attachment + modal submit.
// Slack sends application/x-www-form-urlencoded with a `payload` JSON field; ack within 3s.

import { verifySlackRequest } from '../../../../lib/slack/verify';
import { openModal, postMessage } from '../../../../lib/slack/client';
import { editModal } from '../../../../lib/slack/blocks';
import { confirmBugBrief } from '../../../../lib/slack/backend';
import { getDraft } from '../../../../lib/slack/mock-backend';

export const runtime = 'nodejs';

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
        void confirmBugBrief(runId); // → package_confirmed; status thread animates via /events
        return new Response('', { status: 200 });

      case 'reflex_edit': {
        const draft = getDraft(runId);
        if (draft) await openModal(payload.trigger_id, editModal(runId, draft));
        return new Response('', { status: 200 });
      }

      case 'reflex_add_attachment':
        if (channel) {
          await postMessage({
            channel, thread_ts: threadTs, text: 'Add an attachment',
            blocks: [{ type: 'section', text: { type: 'mrkdwn', text: '📎 Upload a screenshot or recording *in this thread* and I’ll fold it into the report.' } }],
          });
        }
        return new Response('', { status: 200 });

      case 'reflex_open_recorder': // URL button — Slack opens it; nothing to do server-side
        return new Response('', { status: 200 });
    }
  }

  // Edit modal submitted → send edited fields to the same confirmation route.
  if (payload.type === 'view_submission' && payload.view?.callback_id === 'reflex_edit_submit') {
    const runId: string = payload.view.private_metadata;
    const v = payload.view.state?.values ?? {};
    const edits = {
      whereItHappens: v.where_block?.where_input?.value ?? '',
      actualBehavior: v.actual_block?.actual_input?.value ?? '',
      expectedBehavior: v.expected_block?.expected_input?.value ?? '',
    };
    void confirmBugBrief(runId, edits);
    return new Response('', { status: 200 }); // closes the modal
  }

  return new Response('', { status: 200 });
}
