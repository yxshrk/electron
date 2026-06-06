# Reflex — Shared Contracts (the anti-collision spec)

> **This is the single source of truth for every interface that crosses a person boundary.**
> If you are about to invent a field name, a route, a status string, a table column, or an env
> var that another person will touch, it goes **here first**, then into your plan. Changing a
> contract is a one-line Slack message to the other two owners, not a silent edit.
>
> Anchored to [`../TECHNICAL_DOCUMENT.md`](../TECHNICAL_DOCUMENT.md) (canonical architecture) and
> the verified API research in `STACK_RESEARCH.md` (on branch `laurence/replicas-dispatch`).

---

## 0. The three vertical slices

We split by **interface boundary**, not by page (per TECHNICAL_DOCUMENT.md §12). Each person owns
one vertical with one input contract and one output contract.

```text
  ┌──────────────────────┐    ┌────────────────────────────────┐    ┌───────────────────────────┐
  │  LAURENCE — Slack     │    │  YASH — InsForge + Diagnosis   │    │  LUKE — Replicas + PR     │
  │  (front door)         │    │  (brain + source of truth)     │    │  (hands)                  │
  ├──────────────────────┤    ├────────────────────────────────┤    ├───────────────────────────┤
  │ /reflex slash cmd     │    │ InsForge schema + SDK client   │    │ agent/replicas/* scaffold │
  │ attachments → storage │    │ ingest → observations          │    │ /api/.../dispatch-replicas│
  │ thread status updates │    │ multimodal symptom extraction  │    │ /api/replicas/callback    │
  │ confirm/edit buttons  │    │ draft bug brief + diagnose     │    │ reproduce in sandbox      │
  │                       │    │ hypotheses + confirm loop      │    │ fix + open GitHub PR      │
  └─────────┬────────────┘    └───────────┬────────────────────┘    └────────────┬──────────────┘
            │  C1 IntakePayload            │  C3 DispatchInput                     │
            ├────────────────────────────►│──────────────────────────────────────►│
            │  C2 BriefDraft + StatusEvent │                                       │
            │◄────────────────────────────┤◄──────────────────────────────────────┤
                                              C4 EvidencePayload
```

The **InsForge database (Yash) is the shared source of truth.** Nobody infers pipeline state
locally; everyone reads/writes the `capture_sessions.status` row. (TECHNICAL_DOCUMENT.md §12.3)

---

## 1. Naming standardization (read this first to avoid churn)

The repo currently has two architecture drafts with different nouns. **We standardize on the
`main` branch + the existing code scaffold:**

| Concept | Canonical name | Aliases you may see (do not use in new code) |
|---|---|---|
| A single bug report run | `capture_sessions` row, id = **`sessionId`** | `runs` / `runId` (slack-first draft) |
| Media (screenshot/recording) | `observations` row | `media` (slack-first draft) |
| Intake source value | `source: "slack" \| "web" \| "manual"` | — |

Rationale: the merged `agent/replicas/types.ts` already ships `DispatchInput.sessionId` and
`EvidencePayload.sessionId`. Aligning everyone to `sessionId` means **zero rename churn** when
Luke's scaffold meets Yash's backend. If you need the Slack-first `runId` ergonomics, alias it in
your own layer — never on the wire.

---

## 2. State machine (owned by Yash, written by all)

Stored on `capture_sessions.status`. Every transition is a DB write; the UI/Slack thread only ever
renders the latest stored value. (TECHNICAL_DOCUMENT.md §12.3)

```text
created → observed → diagnosed → confirmed → dispatched → reproduced → fixed → shipped
```

| Status | Set by | Meaning |
|---|---|---|
| `created` | Laurence | `/reflex` fired; session row exists |
| `observed` | Laurence → Yash | transcript + media stored as observations |
| `diagnosed` | Yash | symptom + hypotheses generated |
| `confirmed` | Yash (on user confirm) | user approved the brief in Slack; safe to spend agent credits |
| `dispatched` | Luke | Replicas task(s) started |
| `reproduced` | Luke | sandbox proved the bug |
| `fixed` | Luke | fix applied, tests pass in sandbox |
| `shipped` | Luke | PR open, linked to session |

**Failure states** (terminal; surface to Slack thread):

```text
diagnosis_failed   dispatch_failed   reproduction_failed   pr_failed
```

> The `confirmed` state is **new vs TECHNICAL_DOCUMENT.md §12.3** — it is the "confirm back to the
> user" gate the user asked for, sitting between `diagnosed` and `dispatched`. Do not dispatch
> Replicas (real credits) until `confirmed`.

---

## 3. The contract chain

Four contracts cross boundaries. TS interfaces are authoritative; JSON is illustrative.

### C1 — `IntakePayload` (Laurence → Yash)

The normalized report. Laurence converts a Slack command (or web form) into exactly this and
`POST`s it to Yash's intake. Mirrors TECHNICAL_DOCUMENT.md §8 `POST /api/intake` + §12.2.

```ts
interface IntakePayload {
  source: 'slack' | 'web' | 'manual';
  role: 'sales' | 'ceo' | 'product' | 'engineer';   // drives the diagnostic lens (§5)
  repoUrl: string;                                   // target repo, e.g. https://github.com/yxshrk/electron
  transcript: string;                                // the user's raw words / Slack message text
  media?: Array<{
    kind: 'screenshot' | 'recording';
    storageKey: string;                              // InsForge Storage key (Laurence uploaded it)
    url?: string;                                    // signed/public URL if available
    timestampMs?: number;
  }>;
  slackContext?: {                                   // present when source = 'slack'; Yash stores it so
    channelId: string;                               // status updates can be routed back to the thread
    threadTs: string;
    userId: string;
  };
}
```

Returns: `{ "sessionId": "sess_123", "status": "created" }`.

### C2 — `BugBriefDraft` + `StatusEvent` (Yash → Laurence)

Two things flow back toward Slack:

**(a) `BugBriefDraft`** — the compact, role-translated brief the user must confirm or edit before
any credits are spent (TECHNICAL_DOCUMENT.md §5 example; slack-first "Bug Brief Builder").

```ts
interface BugBriefDraft {
  sessionId: string;
  role: string;
  symptom: string;                 // structured engineering symptom, e.g. "Report export hangs on large datasets"
  evidence: string[];              // bullet points pulled from screen + transcript
  hypotheses: Array<{ id: string; title: string; confidence: number }>;
  needsConfirmation: true;         // Laurence renders Confirm / Edit buttons for this
}
```

**(b) `StatusEvent`** — every pipeline transition, so Laurence can update the Slack thread (and the
optional web dashboard). Delivered via InsForge Realtime channel `session:{sessionId}` **or**
polled from `GET /api/sessions/{sessionId}`. Mirrors TECHNICAL_DOCUMENT.md §8 events.

```ts
interface StatusEvent {
  sessionId: string;
  type: 'diagnosis.created' | 'brief.ready' | 'session.confirmed'
      | 'agent.dispatched' | 'agent.reproduced' | 'agent.fixed' | 'pr.opened'
      | `${'diagnosis'|'dispatch'|'reproduction'|'pr'}_failed`;
  status: string;                  // the new capture_sessions.status
  detail?: string;                 // human-readable line for the thread
  prUrl?: string;                  // present on pr.opened
}
```

### C3 — `DispatchInput` (Yash → Luke)

**Already shipped** in `agent/replicas/types.ts`. One hypothesis at a time. Yash only emits this
**after** `status = confirmed`. (TECHNICAL_DOCUMENT.md §12.2 "Luke→Laurence" block, re-pointed to
Luke under the new split.)

```ts
interface DispatchInput {
  sessionId: string;
  repoUrl: string;
  role: string;
  symptom: string;
  hypothesis: { id: string; title: string; reproductionPlan: string; expectedFailure: string };
  environmentId?: string;          // pre-built Replicas Environment bound to the seeded repo
}
```

### C4 — `EvidencePayload` (Luke → Yash)

**Already shipped** in `agent/replicas/types.ts`. The proof + PR. Yash persists it into
`agent_runs` + `pull_requests` and flips `capture_sessions.status`.

```ts
interface EvidencePayload {
  sessionId: string;
  hypothesisId: string;
  status: 'shipped' | 'reproduced' | 'reproduction_failed' | 'pr_failed';
  rootCause: string;
  fixSummary: string;
  verification: string;            // e.g. "Large export fixture completes under the demo timeout"
  logsUrl: string;
  prUrl: string;
  provider: 'replicas' | 'scripted';
}
```

---

## 4. Database schema (owned by Yash)

Canonical tables live in TECHNICAL_DOCUMENT.md §7 (`capture_sessions`, `observations`, `diagnoses`,
`hypotheses`, `agent_runs`, `pull_requests`) + a `memory_nodes` table (pgvector) for the
symptom→resolution graph (STACK_RESEARCH §3). **Only Yash writes migrations.** Read/write access by
person:

| Table | Laurence | Yash | Luke |
|---|---|---|---|
| `capture_sessions` | create + read | **own** (migrations, status writes) | status writes (dispatch→shipped) |
| `observations` | insert (via intake) | **own** | read |
| `diagnoses` | read | **own** | read |
| `hypotheses` | read | **own** | status writes (per hypothesis) |
| `agent_runs` | — | read | **own** (writes) |
| `pull_requests` | read | read | **own** (writes) |
| `memory_nodes` | — | **own** | read (optional) |

If Luke or Laurence needs a column that doesn't exist, ask Yash — do **not** add an ad-hoc table.

---

## 5. Storage bucket convention (created by Yash, written by Laurence)

- Bucket: **`reflex-evidence`** (private), created by Yash in Phase 2.
- Path convention: `sessions/{sessionId}/{kind}-{timestampMs}.{ext}`
  - Laurence writes Slack attachments here → puts the returned `storageKey` into `IntakePayload.media[]`.
  - Yash reads them during multimodal extraction.
  - Luke writes reproduction artifacts here → `sessions/{sessionId}/runs/{runId}/...` and puts the
    URL into `EvidencePayload.logsUrl`.

---

## 6. Route ownership (anti-collision map)

| Route | Owner | Purpose |
|---|---|---|
| `POST /api/slack/reflex-command` | Laurence | slash-command intake |
| `POST /api/slack/events` | Laurence | attachment / message events |
| `POST /api/slack/interactions` | Laurence | Confirm/Edit button clicks → calls Yash's confirm |
| `POST /api/intake` | Yash | normalized intake (C1) → creates session |
| `POST /api/sessions/{id}/observations` | Yash | store transcript + media |
| `POST /api/sessions/{id}/diagnose` | Yash | produce symptom + hypotheses (C2 brief) |
| `POST /api/sessions/{id}/confirm` | Yash | user approved brief → `status = confirmed` |
| `GET  /api/sessions/{id}` | Yash | current state (Laurence polls if no realtime) |
| `GET  /api/sessions/{id}/events` | Yash | SSE/realtime status stream (C2 StatusEvent) |
| `POST /api/sessions/{id}/dispatch` | Luke | confirm → dispatch Replicas (consumes C3) |
| `POST /api/replicas/callback` | Luke | Replicas webhook → writes evidence (C4) |

**Directory ownership** (no two people edit the same file):

```text
app/api/slack/**            → Laurence
app/api/intake/**           → Yash
app/api/sessions/**         → Yash   (except sessions/[id]/dispatch → Luke)
app/api/replicas/**         → Luke
lib/insforge/**             → Yash   (SDK client, schema types, status helpers — shared import)
lib/slack/**                → Laurence
agent/**                    → Luke   (existing replicas scaffold)
insforge/migrations/**      → Yash
developer_plans/**          → all (this folder)
```

`lib/insforge/` is the **one shared import surface** — Yash owns it; Laurence and Luke import its
typed client + the `Status`/contract types but do not edit it (request changes via Yash).

---

## 7. Environment variables (split by owner)

Server-side only; never ship privileged keys to the browser. (TECHNICAL_DOCUMENT.md §11)

```text
# Yash (InsForge + model)
INSFORGE_PROJECT_URL=
INSFORGE_API_KEY=            # service/anon key for server routes
MODEL_API_KEY=              # OpenRouter via InsForge gateway (npx @insforge/cli ai setup)

# Laurence (Slack)
SLACK_BOT_TOKEN=
SLACK_SIGNING_SECRET=
SLACK_APP_TOKEN=            # if using socket mode

# Luke (Replicas + GitHub)
REPLICAS_API_KEY=          # sk_replicas_... (org admin claims credits, code: ainexus)
REPLICAS_ENVIRONMENT_ID=   # pre-built env bound to seeded repo
REPLICAS_WEBHOOK_SECRET=
GITHUB_REPO=yxshrk/electron
# GitHub PRs go through the Replicas GitHub App — no raw token needed for the agent path

# Shared
NEXT_PUBLIC_APP_URL=
```

Keep one shared `.env.example` at repo root; each owner adds their block.

---

## 8. Build order (so three people start now, in parallel)

Adapted from TECHNICAL_DOCUMENT.md §12.4 for the new split:

1. **Yash** scaffolds Next.js + InsForge + schema + `lib/insforge/` client + `/api/intake` (returns
   a real `sessionId`). **This unblocks everyone** — do it first, publish the contract types.
2. **Laurence** builds Slack intake against a **mocked** `/api/intake` (the C1 shape above), then
   swaps to Yash's real endpoint.
3. **Luke** keeps building `agent/replicas/*` against `examples/dispatch-input.json` (the C3 shape)
   and the **scripted fallback** — no dependency on Yash/Laurence to make a PR.
4. **Yash** adds `/api/sessions/{id}/diagnose` + the brief/confirm loop (deterministic JSON for the
   rehearsed transcript).
5. **Yash + Luke** wire `/api/sessions/{id}/dispatch` → `dispatchHypothesis()` → `/api/replicas/callback`.
6. **Laurence** wires the live Slack thread to Yash's `StatusEvent` stream.
7. **All three** rehearse the full Slack-to-PR script 3× and cut anything that flakes.

Each plan ([Laurence](./laurence-slack-intake.md) · [Yash](./yash-insforge-diagnosis.md) ·
[Luke](./luke-replicas-dispatch-pr.md)) expands its slice against these contracts.
