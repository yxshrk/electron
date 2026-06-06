# Reflex — Tech Stack Research (verification of TECHNICAL_DOCUMENT.md §16)

> Research pass done 2026-06-06 (hackathon day). Each sponsor was researched against the exact
> capability Reflex depends on, not a generic overview. **Bold = decision.** Sources inline.

## TL;DR — the answers that change the plan

1. **Replicas HAS a first-class programmatic REST API** (the #1 open question). You do *not* need Slack/Linear/GitHub triggers. It also has an MCP server + webhooks. → Replicas can be the real, automated, parallel-fan-out spine.
2. **Devin is too slow for a live 90s window** (5–15 min to a PR). → Use it as a **pre-warmed / poll-and-reveal** executor, not a synchronous step. Also: **no free tier — needs ~$20 + a card.**
3. **Skip Gemini Live.** Reflex's output is one structured JSON, not a voice dialogue. Use **periodic screenshots + transcript → a structured-JSON call**, served through a **sponsor gateway** (InsForge's OpenRouter key or Vercel AI Gateway) → stays sponsor-aligned AND more robust for a scripted demo.
4. **Vercel: SSE, not WebSocket** (functions don't support long-lived WS). Watch the **300s function cap (Hobby)** and **4.5 MB body limit** (push screenshots to storage, not through the function body). Vercel **Sandbox** is a clean Replicas fallback for running reproductions.
5. **InsForge is fully ready to scaffold now** — Postgres + pgvector (memory graph), storage, Deno edge functions, OpenAI-compatible model gateway, realtime, MCP for Claude Code.
6. **Limrun: name-as-roadmap by default.** No public free tier (email `contact@limrun.com` for a key), undocumented cold-start. Small integration surface if a key lands early; otherwise show a recorded clip.

---

## 1. Replicas — the engine (PRIMARY agentic path) ✅ programmatic API confirmed

- **Base:** `https://api.tryreplicas.com` · **Auth:** `Authorization: Bearer sk_replicas_...` (dashboard → Settings → API Keys)
- **OpenAPI spec:** `https://docs.tryreplicas.com/openapi.json` (grab first — authoritative)
- **Dispatch:** `POST /v1/replica` — body: `name` (no whitespace), `message` (the brief), `environment_id` (binds repo + setup), `coding_agent` (`claude`|`codex`), `thinking_level`, `lifecycle_policy` (`delete_when_done`), `webhook_url`, `size` (`small` $0.008/min · `large` $0.016/min).
- **CRITICAL header for parallel fan-out:** `X-Replicas-Api-Version: 2026-05-17` → returns immediately with `status: preparing`. **Omitting it BLOCKS until the workspace is active** — N blocking creates would kill fan-out.
- **Repo + setup/reproduction commands live in the Environment, not the create call.** Pre-build one Environment per seeded repo via `POST /v1/environments` with `repository_id` + **Start/Warm Hooks** (boot scripts: clone, install deps, stage repro command) + env files (≤64 KB). The per-task `message` carries the hypothesis-specific brief.
- **Status / evidence (3 ways):**
  - `GET /v1/replica/{id}` → `status` (`active|sleeping|preparing|error`), `pull_requests[]`, `repository_statuses` (branch, `pr_urls`, `git_diff`). `?include=diffs` to expand. (Getting a *sleeping* replica wakes it.)
  - `GET /v1/replica/{id}/events` → **SSE**, 15s heartbeat. Watch `chat.turn.*`, `hooks.*`, and **`repo.status.changed`** (→ `payload.repos[].prUrls`). This is the live dashboard feed.
  - **Hook Logs** + **Read History** endpoints for repro output / evidence.
- **GitHub PRs:** via the **Replicas GitHub App** (install on target repos) — you don't handle tokens. Coding-agent auth (Claude) is separate (`sk-ant-` key / Bedrock / `replicas claude-auth`).
- **Webhooks:** `webhook_url` or `{url, secret}` → events `replica.ready`, **`replica.turn_completed`** (carries PR URLs), `replica.deleted`, `replica.error`. HMAC `X-Replicas-Signature: sha256=...`, respond 2xx within 10s.
- **MCP server:** `https://api.tryreplicas.com/v1/mcp` (Bearer) or `npx -y replicas-mcp` — tools incl. `create_replica`, `get_replica`, `list_replicas`, `send_replica_message`. Good agent-driven fallback.
- **Free tier:** Hobby = one-time **1,200 min human + 1,200 min API/automation**, 3 repos / 5 envs / 2 automations. ⚠️ **VERIFY a Hobby key issues API access** (paid Developer $120/mo explicitly lists "API access"; Hobby strongly implies but confirm — it gates the whole free plan).
- **Concurrency:** no documented cap or rate limit; build retry/backoff; test a fan-out of 3 before relying on more.
- **Recommended:** primary = REST (`POST /v1/replica` with the version header, fan out 3, SSE per replica, webhook for done). Fallback = MCP server. Last resort = @-mention `@tryreplicas` on GitHub issues.
- **First actions:** download `openapi.json`; confirm Hobby-tier API key.

Sources: docs.tryreplicas.com/llms.txt, /api-reference/replica/{create-replica,get-replica,stream-events}, /features/mcp, /quickstart, tryreplicas.com/pricing.

## 2. Devin — second executor (implement confirmed fix) ⚠️ slow + paid

- **Base:** `https://api.devin.ai/v1` · **Auth:** `Authorization: Bearer cog_...` (service user: app.devin.ai → Settings → Service users; key shown once).
- **Create:** `POST /v1/sessions` — only `prompt` required (put repo + root cause + evidence in the prompt; **no dedicated repo field**). Useful optionals: `snapshot_id` (pre-cloned repo+deps — **biggest speedup**), `playbook_id` (reusable fix procedure — **biggest reliability lever**), `max_acu_limit` (hard cost cap), `structured_output_schema` (force `{pr_url, files_changed}` back). Returns `{session_id, url, is_new_session}`.
- **Status:** `GET /v1/sessions/{id}` → `status_enum` (`working|blocked|finished|...`), **`pull_request.url`**, `structured_output`. Poll until `finished`/`blocked`/PR present. (Files-changed: read from the PR or have Devin emit it into structured_output.)
- **Follow-up:** `POST /v1/sessions/{id}/message` (singular `/message` in v1) `{message}` — to unblock when `blocked`.
- **Terminate:** `POST /v1/sessions/{id}/terminate` (no v1 DELETE). List: `GET /v1/sessions`.
- **GitHub:** install the **Devin GitHub App** (github.com/apps/devin-ai-integration) on the target repo once, org-level. No per-session repo auth.
- **Latency: 5–15 min to a PR.** Does NOT fit 90s cold. → **Pre-warm**: fire `POST /sessions` the moment the first agent confirms the bug; on stage just poll + reveal `pull_request.url`. Use `snapshot_id` + `playbook_id` to cut setup/exploration.
- **Cost: NO free tier.** ~$2.25/ACU (1 ACU ≈ 15 min work), Core plan ~$20 to start. Budget **~$20 + a real card**. A demo run ≈ $1–5; bound with `max_acu_limit`.
- **Hackathon fallback:** if key/budget unavailable, keep Replicas as primary executor and present Devin as the "second-agent" roadmap path.

Sources: docs.devin.ai/llms.txt, /api-reference/v1/sessions/*, /api-reference/authentication, /integrations/gh; pricing/latency third-party (devin.ai/pricing, cognition.ai/blog/devin-101).

## 3. InsForge — backend + memory (PRIMARY sponsor) ✅ ready to scaffold

- **Provision:** cloud (insforge.dev → Create Project, ~3s, gives Project ID) — recommended; this path auto-provisions the OpenRouter key. (Self-host via Docker also exists.)
- **CLI:** `npx @insforge/cli login` · `link --project-id <id>` · `current` · `metadata` (discover baseUrl/keys/schema). DB: `db migrations new|up|list`. Also `functions`, `storage`, `secrets`, `ai setup`, `diagnose`.
- **SDK:** `npm i @insforge/sdk@latest` → `createClient({ baseUrl, anonKey })`. Namespaces: `database` (PostgREST-style `.from().select().eq()...`), `auth`, `storage` (`.from(bucket).upload/uploadAuto/download/remove` — **always persist returned `key`/`url`**), `functions.invoke(slug,{body})`, `ai`, `realtime`. All return `{data, error}`.
- **REST:** records `GET/POST/PATCH/DELETE /api/database/records/{table}` (PostgREST filters; POST body = array; `Prefer: return=representation`). Function invoke = `ANY /functions/{slug}` (**no `/api` prefix**). AI = `/v1/chat/completions`, `/v1/embeddings`, `/v1/models`.
- **DB / pgvector:** migrations (recommended, git-tracked SQL — no BEGIN/COMMIT in files), admin REST, or dashboard/MCP. **pgvector confirmed** (`create extension vector`, `vector(1536)`, HNSW index, `<=>` cosine) → ideal for the symptom→resolution **memory graph**; wrap search in an RPC.
- **Edge functions:** **Deno** TS, default-exported `(req: Request) => Response`, secrets via `Deno.env`, triggers = HTTP / cron / DB-change. Deploy via CLI/MCP/dashboard. (`Deno.run` blocked; timeout/memory undocumented.)
- **Model Gateway (`/api/ai/`):** OpenAI-compatible, backed by **OpenRouter** — InsForge **provisions the key** (admin `GET /api/ai/openrouter/api-key`, or `npx @insforge/cli ai setup` writes it to local `.env`). Model ids `provider/model` (`openai/gpt-4o`, `anthropic/claude-3.5-haiku`, etc.). **Vision confirmed** (image content blocks) → covers screenshot understanding. Credits: rely on OpenRouter free models or attach billing (no documented InsForge grant).
- **MCP for Claude Code:** `npx add-mcp https://mcp.insforge.dev/mcp` → `claude /mcp` → authenticate. Skills: `npx skills add insforge/insforge-skills` (db/storage/functions/deploy/debug). **This is how we drive InsForge from Claude Code.**
- **Realtime:** Socket.IO channels — `insforge.realtime.subscribe('session:123')` / `.on(evt)` / `.publish(...)`. DB change feeds + presence → stream pipeline events to UI.
- **Sites** (frontend hosting, Vercel integration referenced) + **Compute** (containers, private preview — skip; use edge functions for orchestration).
- A ready-to-run scaffold (migration for all 6 tables + memory_nodes/pgvector + match RPC, storage bucket, diagnose edge function, SDK init) is in the agent report — paste when we start Phase 1.

Sources: docs.insforge.dev + /llms.txt, insforge.dev/skill.md, github.com/InsForge/InsForge, github.com/InsForge/insforge-skills.

## 4. Multimodal symptom extraction — periodic screenshots, sponsor gateway ✅ decided

- **Gemini Live CAN do continuous screen frames + audio** over one WebSocket (`gemini-3.1-flash-live-preview`; video capped 1 fps; **audio+video sessions ~2 min**; ephemeral tokens for browser). **But we don't need it** — Reflex's output is one structured symptom JSON, not a spoken dialogue.
- **Decision: periodic screenshots + transcript → structured-JSON call.** Capture speech via browser Web Speech API → transcript; grab a few `getDisplayMedia` JPEG frames; POST [frames + transcript + schema] for structured JSON. Deterministic, retryable, no 2-min cap — exactly the "fake honestly" path the docs sanction.
- **Provider: go sponsor-aligned**, not raw Gemini (Gemini is NOT a sponsor). Serve a vision model through **InsForge's OpenRouter key** or **Vercel AI Gateway** (Claude Opus 4.8 / GPT-4o / Gemini Flash all reachable). Keep raw Gemini (`gemini-3-flash`, free tier, `@google/genai` SDK, `responseMimeType:application/json` + `responseSchema`) only as a zero-setup fallback.

Sources: ai.google.dev/gemini-api/docs/{live-api,structured-output,models,rate-limits}, openrouter.ai/collections/vision-models, Vercel AI Gateway docs.

## 5. Vercel — the face + light backend ✅

- **Streaming: SSE, not WebSocket** (Vercel functions don't support long-lived inbound WS; AI SDK 5 itself moved to SSE). Return a streaming `Response`/`ReadableStream` from a **Node runtime** route, write `data: {...}\n\n` per pipeline node. Client = `EventSource`.
- **Duration caps:** Hobby **300s hard**, Pro **800s** (`export const maxDuration = ...`). If the pipeline can exceed that, run it out-of-band and have the SSE route **relay from pub/sub (Upstash/Ably)**. For a <5-min demo, stream directly.
- **Body limit 4.5 MB** → push screen frames/screenshots to blob storage, reference by URL; don't POST through the function body.
- **AI SDK (`ai`, v6):** `generateObject`/`streamObject` + Zod schema for symptom/hypothesis JSON; `streamObject` `partialOutputStream` can fill hypotheses live in the UI.
- **AI Gateway** (`https://ai-gateway.vercel.sh/v1`, key `AI_GATEWAY_API_KEY` or OIDC on Vercel): one key → hundreds of models, **auto failover** (good demo resilience), **vision supported**, **$5/30-day free credit**. Good choice for the vision + diagnosis model.
- **v0** (Next.js + React + Tailwind + shadcn): scaffold the capture-UI chrome + pipeline-viz node graph fast (`npx shadcn add "<v0 url>"` or GitHub push); hand-wire `getDisplayMedia`, mic, and the SSE subscription yourself.
- **Sandbox** (`@vercel/sandbox`, microVMs, root, **up to 45 min**): clean **Replicas fallback** to actually run reproductions — as a separate job that publishes progress the SSE route relays.
- **Deploy:** `vercel login` → `vercel link` → `vercel env add ...` → `vercel` (preview) → `vercel --prod`. Hobby tier fine for the demo.

Sources: vercel.com/docs/{functions/limitations,functions/streaming-functions,ai-gateway,sandbox,cli}, ai-sdk.dev, v0.app/docs.

## 6. Limrun — mobile stretch ⚠️ name-as-roadmap

- Cloud iOS sims / Android emulators / remote Xcode builds. SDK `@limrun/api` (lifecycle: `iosInstances.create/get/delete/list`), driving via **`lim` CLI** (`tap-element`, `screenshot`, `app-log`, `element-tree`, `perform`) or `@limrun/ui` `<RemoteControl url token />`. Two-tier auth: org key `lim_...` → per-instance scoped token (browser/agent never sees org key). Signed stream URL = shareable live view.
- ⚠️ **No public free tier / pricing**, **undocumented cold-start** → both can sink it. Get a key via console.limrun.com or email `contact@limrun.com` **first thing** if you want this path.
- **Recommendation: name-as-roadmap by default.** If a key + credits land by mid-morning, the minimal beat is cheap (1–3 hrs): pre-warm an instance with `initialAssets`, agent drives `launch-app → tap-element → screenshot → app-log` to reproduce a tap-triggered bug, embed `<RemoteControl />` for a live shareable view. Otherwise show a recorded clip. **Do not put on the critical path.**

Sources: docs.limrun.com/docs/{quickstart,agents/cli,platform/embed-simulator,ios/build-with-xcode}, github.com/limrun-inc.

---

## Updated risk table (deltas from §15)

| Risk (from §15) | New status after research |
|---|---|
| Replicas programmatic dispatch unavailable | **RESOLVED** — REST API + MCP + webhooks all exist. (Verify Hobby-tier API key.) |
| Devin API unavailable / slow | Partly real — **slow (5–15 min) and paid (no free tier)**. Mitigate: pre-warm + snapshot + playbook; budget $20. |
| Multimodal extraction unreliable | Mitigated by decision: periodic-screenshot structured JSON, not Live streaming. |
| Sandbox startup slow | Replicas: use version header (non-blocking) + warm hooks. Fallback: Vercel Sandbox. |
| Sponsor APIs differ from assumptions | Largely verified above; remaining unknowns flagged ⚠️. |

## Open items still to verify live (small, gating)

1. Replicas: does a **Hobby-tier** account issue an API key? (gates free plan) + pull `openapi.json` for exact `config`/`message` schema.
2. Devin: confirm budget/card available; pre-build a snapshot + fix-playbook.
3. InsForge: exact `functions`/`storage` CLI subcommand flags (`npx @insforge/cli help functions`); whether the managed OpenRouter key has credits or we use free models.
4. Limrun: email for a key + hackathon credits NOW if attempting the mobile beat.
5. Confirm day-of judging criteria + per-sponsor prize requirements.
