// POST /api/slack/events — Slack Events API: URL verification + file_shared.
// A dropped screenshot/recording → (TODO) InsForge Storage → media on the run.

import { verifySlackRequest } from '../../../../lib/slack/verify';
import { fileInfo, downloadFile } from '../../../../lib/slack/client';

export const runtime = 'nodejs';

export async function POST(req: Request): Promise<Response> {
  const rawBody = await req.text();
  const body = JSON.parse(rawBody) as any;

  // Slack URL verification handshake (sent once when you set the Request URL).
  if (body.type === 'url_verification') {
    return Response.json({ challenge: body.challenge });
  }

  if (!verifySlackRequest({
    signingSecret: process.env.SLACK_SIGNING_SECRET ?? '',
    signature: req.headers.get('x-slack-signature'),
    timestamp: req.headers.get('x-slack-request-timestamp'),
    rawBody,
  })) {
    return new Response('invalid signature', { status: 401 });
  }

  void handleEvent(body);
  return new Response('ok', { status: 200 });
}

async function handleEvent(body: any): Promise<void> {
  const event = body.event;
  if (event?.type === 'file_shared' && event.file_id) {
    try {
      const info = await fileInfo(event.file_id);
      const bytes = await downloadFile(info.url_private_download);
      // TODO: upload to InsForge Storage `reflex-evidence` at runs/{runId}/{kind}-{ts}.{ext}
      //   (via lib/insforge once Yash ships it), then POST /api/runs/{runId}/media.
      //   runId is resolved from the thread the recorder/command opened.
      void bytes;
    } catch { /* a failed attachment shouldn't break the run */ }
  }
}
