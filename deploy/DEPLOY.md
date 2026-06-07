# Reflex — Vercel deploy guide

Everything to get the Next.js app (Luke's scaffold) onto Vercel correctly. Config templates
live next to this file. Architecture choices are from `../STACK_RESEARCH.md` §5.

## 0. Sponsor credits (do once)
- **v0 — $30** (first 200 people): redeem code **`V0-AI-NEXUS`** on v0.app → account → Billing/Redeem.
  Status: ✅ $30 already on the hackathon account.
- That's the only Vercel item in the sponsor doc. AI Gateway also gives **$5 free / 30 days**, no code needed.

## 1. CLI + auth
```bash
npm i -g vercel            # installed: Vercel CLI 54.9.1
vercel whoami              # ✅ logged in as `laurenceshao` (email butsushiwushi@gmail.com — same account that holds the $30)
# to switch accounts:  vercel logout && vercel login
```

## 2. Connect the GitHub repo in Vercel

Use the dashboard path for the hackathon demo so production deploys follow `main` automatically:

1. Open Vercel Dashboard.
2. Click **Add New... → Project**.
3. Under **Import Git Repository**, pick `yxshrk/electron`.
4. Keep **Framework Preset** as `Next.js`.
5. Keep **Root Directory** as the repository root.
6. Add the environment variables below before the production deploy.
7. Click **Deploy**.

Vercel reads `vercel.json` from the repository root.

## 3. Link + env from CLI (optional)
```bash
vercel link                       # link folder ↔ Vercel project
vercel env pull .env.local        # pull any env already set in the dashboard
# add secrets (or set them in the dashboard):
vercel env add NEXT_PUBLIC_APP_URL
vercel env add REFLEX_BACKEND
vercel env add REFLEX_AUTO_DISPATCH
vercel env add INSFORGE_PROJECT_URL
vercel env add INSFORGE_SERVICE_KEY
vercel env add OPENROUTER_API_KEY
vercel env add SLACK_SIGNING_SECRET
vercel env add SLACK_BOT_TOKEN
vercel env add DEFAULT_GITHUB_REPO
vercel env add GITHUB_TOKEN
vercel env add REPLICAS_API_KEY
vercel env add REPLICAS_ENVIRONMENT_ID
```

Required production values:

```bash
NEXT_PUBLIC_APP_URL=https://<your-project>.vercel.app
REFLEX_BACKEND=real
REFLEX_AUTO_DISPATCH=false
INSFORGE_PROJECT_URL=https://<appkey>.<region>.insforge.app
INSFORGE_SERVICE_KEY=<insforge-service-key>
SLACK_SIGNING_SECRET=<slack-signing-secret>
SLACK_BOT_TOKEN=<xoxb-token>
DEFAULT_GITHUB_REPO=https://github.com/yxshrk/electron
GITHUB_TOKEN=<github-token-with-contents-and-pull-requests-access>
GITHUB_BASE_BRANCH=main
OPENROUTER_API_KEY=<optional-openrouter-key>
REPLICAS_API_KEY=<optional-live-replicas-key>
REPLICAS_ENVIRONMENT_ID=<optional-live-replicas-environment-id>
```

Server-only secrets must **not** use the `NEXT_PUBLIC_` prefix. That prefix ships values to the
browser.

## 4. Deploy
```bash
vercel                # preview deploy → prints a preview URL (use for testing)
vercel --prod         # production deploy → the demo URL
```

## 5. Update Slack app URLs

After the production URL exists, update the Slack app:

```text
/reflex-report -> https://<your-project>.vercel.app/api/slack/reflex-report
/reflex-record -> https://<your-project>.vercel.app/api/slack/reflex-record
Interactivity -> https://<your-project>.vercel.app/api/slack/interactions
Events -> https://<your-project>.vercel.app/api/slack/events
```

## 6. The 4 gotchas that bite (from research — design for these up front)

1. **SSE, not WebSocket.** Vercel functions don't support long-lived inbound WebSockets.
   Stream pipeline events from a Node route handler with a `ReadableStream` writing
   `data: {...}\n\n` frames; client consumes via `EventSource`. (AI SDK 5+ uses SSE too.)
2. **300s function cap on Hobby** (Pro = 800s). Set `maxDuration` (see `vercel.json`). If a
   single agent run can exceed it, don't hold it in the request — run it out-of-band and have
   the SSE route relay status from InsForge (poll or Realtime).
3. **4.5 MB request/response body limit.** Push screen-share frames / screenshots to InsForge
   Storage and pass URLs — never POST raw base64 images through the function body at size.
4. **Node runtime, not Edge**, for the API routes (full Node APIs + the longer duration window).
   Add `export const runtime = 'nodejs'` to route handlers.

## 7. Model access — use AI Gateway
For the diagnosis + screenshot/vision model, route through **Vercel AI Gateway**
(`AI_GATEWAY_API_KEY`, or OIDC when deployed on Vercel — no key needed). One key → many
providers, automatic failover (good demo resilience), vision-capable. With AI SDK v6:
```ts
import { generateObject } from 'ai';
import { z } from 'zod';
const { object } = await generateObject({
  model: 'anthropic/claude-sonnet-4.6',   // routed via AI Gateway, no provider import (confirm exact slug in the gateway model list)
  schema: z.object({ symptom: z.string(), hypotheses: z.array(z.object({
    title: z.string(), confidence: z.number(), reproductionPlan: z.string(),
    expectedFailure: z.string() })) }),
  prompt: '...screenshot + transcript...',
});
```

## 8. v0 for the UI (optional, fast)
Generate the capture-UI chrome + pipeline-viz node graph in v0, pull in with
`npx shadcn@latest add "<v0-block-url>"`. Hand-wire `getDisplayMedia`, mic, and the SSE
subscription yourself — v0 won't do those.
