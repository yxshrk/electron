# Luke — Replicas Dispatch, Reproduce, Fix & PR (the hands)

> **Mission:** Own the proof. Take one confirmed hypothesis (`DispatchInput`, C3), spin up a
> **Replicas** coding agent in a sandbox that **reproduces** the bug (proof, not a guess),
> **localizes + fixes** it, and **opens a GitHub PR** — then return the evidence (`EvidencePayload`,
> C4). You inherit the existing `agent/replicas/*` scaffold and the scripted fallback, so you can
> produce a real PR **today** with zero dependency on Yash or Laurence.
>
> This is the **winning spine**: `structured symptom → sandbox reproduction → fix → green PR`
> (TECHNICAL_DOCUMENT.md §19). Build it first.

Anchored to: [`shared-contracts.md`](./shared-contracts.md) · `TECHNICAL_DOCUMENT.md` §6 (Agent
Orchestrator, Replicas Sandbox Agents), §10 (Demo Repo), §12.2 · `STACK_RESEARCH.md` §1 (verified
Replicas REST API) · existing code `agent/replicas/*` (branch `laurence/replicas-dispatch`).

```text
                                              ┌───────────────────────────┐
   C3 DispatchInput  ──────────────────────► │  LUKE — Replicas + PR ◄─YOU│
   (from Yash, after status=confirmed)        ├───────────────────────────┤
                                              │ agent/replicas/dispatch.ts │  POST /v1/replica
   C4 EvidencePayload ◄───────────────────── │ SSE stream → repro evidence │  (version header!)
   (to Yash → persists + projects status)     │ fix → Replicas GitHub App  │  → PR
                                              │ scripted-fallback.ts (safe) │
                                              └───────────────────────────┘
```

---

## 1. What the rest of the app expects FROM you

| You must produce | Shape | Consumer |
|---|---|---|
| A dispatch entrypoint | `dispatchHypothesis(DispatchInput, { onEvent })` | Yash calls it from `/api/sessions/{id}/dispatch` |
| Live progress events | `ReplicaEvent`s via `onEvent` | Yash projects → `StatusEvent` → Slack |
| The evidence + PR | `EvidencePayload` (C4) → `POST /api/replicas/callback` | Yash persists `agent_runs`/`pull_requests` |
| A real PR on the seeded repo | GitHub PR via Replicas GitHub App | the demo finale |
| Writes to `agent_runs` + `pull_requests` | per shared-contracts §4 | (you own these tables' writes) |

## 2. What you expect FROM the rest of the app

| You consume | From | Shape |
|---|---|---|
| One confirmed hypothesis | Yash (only after `status=confirmed`) | `DispatchInput` (C3) — already in `agent/replicas/types.ts` |
| A pre-built Replicas Environment id | setup (one-time) | `environmentId` bound to the seeded repo |
| The seeded demo repo + a real bug | shared (TECHNICAL_DOCUMENT.md §10) | `https://github.com/yxshrk/electron` with the export-hang bug |

> You never touch Slack or the diagnosis model. Your world is `DispatchInput` in, `EvidencePayload`
> out — both **already defined in code** (`agent/replicas/types.ts`). Keep them stable.

---

## 3. Owned surface (inherit the scaffold)

```text
agent/replicas/types.ts            # DispatchInput / EvidencePayload / Replica / ReplicaEvent (DONE — keep stable)
agent/replicas/client.ts           # thin Replicas REST client (POST /v1/replica, SSE, GET)
agent/replicas/dispatch.ts         # dispatchHypothesis(): create → stream → collect PR → EvidencePayload
agent/replicas/scripted-fallback.ts# zero-dependency path: known fix on seeded repo → gh pr create
agent/run.ts                       # CLI entry (dispatch:dry / dispatch)
agent/examples/dispatch-input.json # the C3 sample you test against
app/api/sessions/[id]/dispatch/route.ts  # Yash's session route delegates here (you own this file)
app/api/replicas/callback/route.ts # Replicas webhook → build EvidencePayload → hand to Yash's persist
```

Env you own (shared-contracts §7): `REPLICAS_API_KEY`, `REPLICAS_ENVIRONMENT_ID`,
`REPLICAS_WEBHOOK_SECRET`, `GITHUB_REPO`.

---

## 4. The Replicas integration (verified — STACK_RESEARCH §1)

- **Base:** `https://api.tryreplicas.com` · **Auth:** `Authorization: Bearer sk_replicas_...`
- **Dispatch:** `POST /v1/replica` — body: `name` (no whitespace), `message` (the agent brief built
  from `DispatchInput`), `environment_id` (binds repo + setup), `coding_agent: 'claude'`,
  `lifecycle_policy: 'delete_when_done'`, `webhook_url`, `size`.
- **CRITICAL for fan-out:** send header **`X-Replicas-Api-Version: 2026-05-17`** → returns
  immediately with `status: preparing`. **Omitting it BLOCKS** until the workspace is active — N
  blocking creates would kill parallel fan-out. (This is the #1 gotcha — STACK_RESEARCH §1.)
- **Repo + reproduction commands live in the Environment, not the create call.** Pre-build one
  Environment per seeded repo via `POST /v1/environments` with `repository_id` + Start/Warm Hooks
  (clone, install deps, stage the repro command). The per-task `message` carries the
  hypothesis-specific brief (symptom + reproductionPlan + expectedFailure).
- **Evidence (3 ways):** `GET /v1/replica/{id}` (`pull_requests[]`, `repository_statuses` with
  `pr_urls`, `git_diff`); `GET /v1/replica/{id}/events` (**SSE**, 15s heartbeat — watch
  `chat.turn.*`, `hooks.*`, `repo.status.changed` → `payload.repos[].prUrls`); Hook Logs / Read
  History for repro output.
- **PRs:** via the **Replicas GitHub App** (install on the seeded repo) — you don't handle tokens.
- **Webhooks:** `replica.ready`, `replica.turn_completed` (carries PR URLs), `replica.error` — HMAC
  `X-Replicas-Signature: sha256=...`, respond 2xx within 10s → this feeds `/api/replicas/callback`.
- **Coding-agent auth (Claude):** separate from the Replicas key — `replicas claude-auth` (the
  command being set up now) attaches your Claude Code creds to the org so dispatched agents can code.

## 5. Build plan (phased) — spine first

### Phase K0 — Scaffold runs locally (already mostly done)
- `cd agent && npm install && cp .env.example .env`.
- `npm run dispatch:dry` prints the agent brief with **no API call** (works without a key) — verify
  your `DispatchInput → message` brief builder reads well.
- **Success:** dry run prints a sensible brief from `examples/dispatch-input.json`.

### Phase K1 — Scripted fallback PR (the safety net — build THIS before live Replicas)
- `scripted-fallback.ts`: on the seeded repo, apply the known export-hang fix on a fresh branch →
  `gh pr create` → return an `EvidencePayload { provider: 'scripted', status: 'shipped', prUrl }`.
- **Success:** one command opens a real PR on `yxshrk/electron` with reproduction notes — **the demo
  cannot fail** even with no Replicas/wifi. (TECHNICAL_DOCUMENT.md §12.5, §13 fallback.)

### Phase K2 — Live Replicas dispatch (one hypothesis)
- One-time setup (gated on a human — see §6 below): org admin claims credits
  (`tryreplicas.com/dashboard/insforge-hackathon`, code **`ainexus`**), creates `REPLICAS_API_KEY`,
  installs the GitHub App on the seeded repo, builds one Environment → `REPLICAS_ENVIRONMENT_ID`.
- `dispatch.ts`: `POST /v1/replica` (with the version header) → SSE stream → on `repo.status.changed`
  collect the PR URL → build `EvidencePayload { provider: 'replicas' }`.
- **Success:** `npm run dispatch examples/dispatch-input.json` reproduces the seeded bug and opens a
  real PR; evidence JSON on **stdout** (progress on stderr — keep stdout clean for piping).

### Phase K3 — Wire into the app
- `app/api/sessions/[id]/dispatch/route.ts`: import `dispatchHypothesis`, call with the
  `DispatchInput` Yash emits on confirm, forward `onEvent` → Yash's status publish.
- `app/api/replicas/callback/route.ts`: verify HMAC → build `EvidencePayload` → call Yash's persist
  (writes `agent_runs` + `pull_requests`, flips status). Set `status='dispatched'` on start,
  `reproduced`/`fixed`/`shipped` (or `*_failed`) as events arrive.
- **Success:** Yash's `confirm` → your dispatch → PR → Yash projects `pr.opened` → Laurence's thread
  shows the PR.

### Phase K4 — Parallel fan-out (stretch — TECHNICAL_DOCUMENT.md §6, §13 "fake if slow")
- With the version header, fire the top **3** hypotheses concurrently; first to reproduce wins; let
  the others be cancelled (`delete_when_done`). Test a fan-out of 3 before relying on more
  (no documented concurrency cap — STACK_RESEARCH §1). Name-as-roadmap if credits/time are tight.

---

## 6. Setup gated on a human (do this early — it's the long pole)

From `agent/README.md` — these need a browser + org admin and block live Replicas (but **not** the
scripted path):

1. One teammate becomes Replicas **org admin**, creates an account.
2. Claim credits at `tryreplicas.com/dashboard/insforge-hackathon`, code **`ainexus`** (3600 credits,
   one per org).
3. Create an API key → `agent/.env` (`REPLICAS_API_KEY`).
4. Install the **Replicas GitHub App** on `yxshrk/electron` (so the agent can open PRs).
5. Build one **Environment** bound to the seeded repo (clone + `npm install` + stage the reproduction
   command as a Start Hook) → put its id in `REPLICAS_ENVIRONMENT_ID` / `dispatch-input.json`.
6. Run `replicas claude-auth` so dispatched agents have Claude coding creds.

Until all six are done, **`scripted-fallback.ts` runs the entire demo** with zero Replicas dependency.

## 7. Seeded demo repo (TECHNICAL_DOCUMENT.md §10 — coordinate, don't solo)
The seeded bug must map cleanly from the vague symptom. Primary: **report export spinner hangs** →
root cause unbounded query / synchronous path → repro: seed large dataset + trigger export → fix:
pagination/streaming/bound → verify: completes under timeout + test passes. Make the reproduction
**deterministic** (seeded fixture + a test that fails before the fix, passes after) so confidence
comes from the sandbox, not an LLM opinion (§6 "the key judging point").

## 8. Testing (TECHNICAL_DOCUMENT.md §14)
- `dispatch:dry` brief builder is stable for each role.
- Agent-run state transitions `pending → running → reproduced → fixed/shipped` (or `*_failed`).
- Scripted fallback opens a valid PR and returns a well-formed `EvidencePayload` (C4 schema).
- Webhook handler verifies HMAC and is idempotent on retries.
- Given the seeded fixture: repro command fails **before** the fix, passes **after** (the proof).

## 9. Fallbacks (build / fake / name — TECHNICAL_DOCUMENT.md §13)

| Layer | Build (real) | Fake (scripted) | Name (roadmap) |
|---|---|---|---|
| Dispatch | real `POST /v1/replica` + SSE | scripted-fallback known fix → PR | Devin as 2nd executor (pre-warm + reveal) |
| Reproduction | real sandbox repro of seeded bug | precomputed logs + seeded patch (§12.5) | repro on arbitrary repos |
| Fan-out | 3 concurrent hypotheses | single hypothesis | N-way adaptive fan-out |
| PR | Replicas GitHub App opens PR | `gh pr create` from local | auto-merge on green CI |

**Demo fallback (§12.5):** if Replicas/GitHub is slow, reveal an already-open demo PR and walk the
precomputed reproduction logs. **Never bet the demo on live sandbox spin-up over conference wifi.**

## 10. Demo ownership (TECHNICAL_DOCUMENT.md §12.5, §18)
You own **"reproduction + fix evidence"** and the **GitHub PR output** — the finale. The PR linked
back to the original Slack report is the closer's payoff. Have a pre-opened PR ready as the §12.5
fallback.

## 11. References
- Contracts: [`shared-contracts.md`](./shared-contracts.md) §2 (state machine — you own dispatch→
  shipped), §3 (C3, C4), §4 (you own `agent_runs`/`pull_requests` writes), §6 (routes), §7 (env).
- Architecture: `TECHNICAL_DOCUMENT.md` §6 (Agent Orchestrator, Replicas Sandbox Agents, Devin),
  §10 (seeded repo), §12.2 (contracts), §13 (build/fake/name), §16–17 (risks/open questions), §19 (spine).
- API research: `STACK_RESEARCH.md` §1 (Replicas REST — the version header gotcha, Environments,
  SSE, GitHub App, webhooks, MCP fallback), §2 (Devin as pre-warm 2nd executor).
- Existing code: `agent/replicas/*` + `agent/README.md` (branch `laurence/replicas-dispatch`) —
  your foundation.
