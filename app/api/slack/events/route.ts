// POST /api/slack/events  — Slack Events API (Phase L2): URL verification + file_shared.
// A dropped screenshot → InsForge Storage → observation on the session.

import { verifySlackRequest } from '../../../../lib/slack/verify';
import { fileInfo, downloadFile } from '../../../../lib/slack/client';
import { addObservation } from '../../../../lib/slack/backend';

export const runtime = 'nodejs';

export async function POST(req: Request): Promise<Response> {
  const rawBody = await req.text();
  const body = JSON.parse(rawBody) as any;

  // Slack URL verification handshake (sent once when you set the Request URL).
  if (body.type === 'url_verification') {
    return Response.json({ challenge: body.challenge });
  }

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

  // Ack within 3s; do the upload in the background.
  void handleEvent(body);
  return new Response('ok', { status: 200 });
}

async function handleEvent(body: any): Promise<void> {
  const event = body.event;
  if (!event) return;

  // A file shared in a channel we're in. (Mapping file→session is keyed off the thread the
  // /reflex command opened; for the MVP we attach to the most recent session — Yash exposes a
  // lookup, or we thread the sessionId through. Left as a TODO marker, see L2 in the plan.)
  if (event.type === 'file_shared' && event.file_id) {
    try {
      const info = await fileInfo(event.file_id);
      if (!info.mimetype?.startsWith('image/')) return;
      const bytes = await downloadFile(info.url_private_download);
      // TODO(L2): upload `bytes` to InsForge Storage `reflex-evidence` at
      //   sessions/{sessionId}/screenshot-{ts}.png  (via lib/insforge once Yash ships it),
      //   then addObservation(sessionId, { kind: 'screenshot', storageKey }).
      void bytes;
      void addObservation;
    } catch {
      // swallow — a failed attachment shouldn't break intake
    }
  }
}
