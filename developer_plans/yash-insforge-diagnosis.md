# Yash — InsForge Ingest, Diagnosis & Confirm-Back (the brain + source of truth)

> **Mission:** Own the InsForge backend and the cognitive core. Ingest everything the report carries
> (transcript + screenshots/recordings), turn it into a **structured engineering symptom + ranked
> hypothesis tree** through the role lens, and run the **confirm-back loop** so the user approves the
> brief before any agent credits are spent. You hold the shared source of truth: the schema, the
> state machine, and the typed contracts the other two import.
>
> Everyone depends on you first — ship the schema + `/api/intake` + `lib/insforge/` types on day one.

Anchored to: [`shared-contracts.md`](./shared-contracts.md) · `TECHNICAL_DOCUMENT.md` §6 (Observation
API, Multimodal Symptom Extraction, Diagnosis Service, InsForge Backend & Memory), §7 (Data Model),
§8 (API surface) · `STACK_RESEARCH.md` §3 (InsForge), §4 (multimodal extraction decision).

```text
                          ┌────────────────────────────────────┐
   C1 IntakePayload  ────►│  YASH — InsForge + Diagnosis ◄── YOU │────►  C3 DispatchInput
   (from Laurence)        ├────────────────────────────────────┤       (to Luke)
                          │ schema + migrations (source of truth)│
   C2 Brief + Status ◄────│ ingest → observations → storage      │◄────  C4 EvidencePayload
   (to Laurence/Slack)    │ multimodal extraction → symptom       │       (from Luke → you persist)
                          │ diagnose → hypotheses → confirm gate  │
                          └────────────────────────────────────┘
```

---

## 1. What the rest of the app expects FROM you

| You must produce | Shape | Consumer |
|---|---|---|
| A linked InsForge project + schema | the 6 tables (§7) + `memory_nodes` | everyone (shared DB) |
| `lib/insforge/` typed client + contract types | `Status`, `IntakePayload`, `BugBriefDraft`, `StatusEvent`, re-export `DispatchInput`/`EvidencePayload` | Laurence + Luke import this |
| A real `sessionId` on intake | `POST /api/intake` → `{ sessionId, status }` (C1) | Laurence |
| The bug brief to confirm | `BugBriefDraft` (C2a) via `diagnose` + event `brief.ready` | Laurence (renders confirm card) |
| A status stream | `StatusEvent` (C2b) via `GET /api/sessions/{id}/events` + `GET /api/sessions/{id}` | Laurence |
| A dispatch trigger after confirm | `DispatchInput` (C3) handed to Luke's dispatch | Luke |
| Persisted evidence + final state | write `agent_runs` + `pull_requests`, flip `status` | Laurence reads via status |

## 2. What you expect FROM the rest of the app

| You consume | From | Shape |
|---|---|---|
| The normalized report | Laurence | `IntakePayload` (C1) |
| Media already in Storage | Laurence | `media[].storageKey` under `sessions/{id}/...` |
| A confirm/edit decision | Laurence (button → your route) | `POST /api/sessions/{id}/confirm` or edited transcript → re-diagnose |
| Reproduction + fix evidence | Luke | `EvidencePayload` (C4) at `/api/replicas/callback` (Luke writes; you read for status projection) |

---

## 3. Owned surface

```text
insforge/migrations/**                  # ALL schema — only you write these
lib/insforge/client.ts                  # @insforge/sdk createClient (server-side)
lib/insforge/types.ts                   # Status union + C1..C4 types (shared import surface)
lib/insforge/status.ts                  # setStatus(sessionId, status) + event publish helper
app/api/intake/route.ts                 # C1 → create capture_session (+ observations if media)
app/api/sessions/[id]/observations/route.ts
app/api/sessions/[id]/diagnose/route.ts # symptom + hypotheses → BugBriefDraft (C2a)
app/api/sessions/[id]/confirm/route.ts  # user approved → status=confirmed → trigger Luke dispatch
app/api/sessions/[id]/route.ts          # GET current state (poll)
app/api/sessions/[id]/events/route.ts   # SSE/realtime StatusEvent stream (C2b)
lib/diagnosis/extract.ts                # screenshots + transcript → visible_state JSON
lib/diagnosis/diagnose.ts               # role lens + symptom + ranked hypotheses (deterministic-friendly)
```

Env you own (shared-contracts §7): `INSFORGE_PROJECT_URL`, `INSFORGE_API_KEY`, `MODEL_API_KEY`.

> **You are the keeper of `lib/insforge/`** — Laurence and Luke import its client and types but do
> not edit it. A schema/contract change starts here, then a one-line ping to the other two.

---

## 4. The diagnosis core (your hardest, most demo-critical work)

### 4.1 Ingest (TECHNICAL_DOCUMENT.md §6 Observation API)
- `/api/intake`: insert `capture_sessions` (role, repo_url, source, slackContext as JSON), set
  `status='created'`. If `media[]` present, insert `observations` rows referencing the storage keys.
- Normalize: one `observations` row per transcript chunk + screenshot; set `status='observed'`.

### 4.2 Multimodal symptom extraction (TECHNICAL_DOCUMENT.md §6; decision in STACK_RESEARCH §4)
- **Do NOT use Gemini Live.** Use **periodic screenshots + transcript → one structured-JSON call**
  through the **InsForge model gateway** (OpenRouter-backed, vision-capable; `npx @insforge/cli ai setup`
  provisions the key). This is deterministic + retryable — the "fake honestly" path the docs sanction.
- `lib/diagnosis/extract.ts`: read screenshot(s) from Storage → vision model with a JSON schema →
  `visible_state` (e.g. `{ "screen": "report export", "ui": "spinner active" }`). Preserve uncertainty.

### 4.3 Diagnosis + role lens (TECHNICAL_DOCUMENT.md §5, §6 Diagnosis Service)
- `lib/diagnosis/diagnose.ts`: fuse `visible_state` + transcript + repo metadata → the **role-aware**
  symptom + ranked hypotheses. The role tag sets translation depth (§5):
  - `sales/ceo` → translate business symptom → technical fault(s).
  - `product` → treat as feature spec.
  - `engineer` → skip translation, go straight to reproduction brief.
- Output the §6 contract object: `{ role, symptom, evidence[], hypotheses[{title, confidence,
  reproductionPlan, expectedFailure}] }`. Persist to `diagnoses` + `hypotheses`; set `status='diagnosed'`.
- **Demo discipline:** for the rehearsed "export hangs" transcript, make the path **deterministic**
  (seeded prompt / cached JSON) so the stage never drifts on stage (§12.5 fallback).

### 4.4 Confirm-back loop (the "confirm back to the user" the user asked for — NEW `confirmed` state)
- After diagnosis, emit `brief.ready` + return a `BugBriefDraft` (C2a). Laurence renders Confirm/Edit.
- `/api/sessions/{id}/confirm`: on Confirm → `status='confirmed'`, then hand the **top hypothesis** to
  Luke as `DispatchInput` (C3). On Edit → re-run `diagnose` with the user's edited wording.
- **This gate protects real Replicas credits** — never dispatch before `confirmed`
  (shared-contracts §2).

### 4.5 Status projection (C2b) for Slack/UI
- `lib/insforge/status.ts`: single `setStatus()` that writes `capture_sessions.status` **and**
  publishes a `StatusEvent` (InsForge Realtime channel `session:{id}`, with `GET /events` SSE +
  `GET /api/sessions/{id}` poll as fallbacks — STACK_RESEARCH §5: Vercel = SSE not WS).
- When Luke writes `EvidencePayload` to `/api/replicas/callback`, project it into the right
  `StatusEvent` (`agent.reproduced` / `agent.fixed` / `pr.opened` / `*_failed`) so Laurence's thread
  updates with zero extra work on his side.

### 4.6 Memory graph (stretch — TECHNICAL_DOCUMENT.md §6 memory, STACK_RESEARCH §3 pgvector)
- `memory_nodes(symptom, resolved_location, cause, fix_type, evidence, embedding vector(1536))` +
  an HNSW cosine index + a `match_memory` RPC. On `shipped`, upsert a node. Name-as-roadmap if time
  is short; even a single seeded node demonstrates "gets smarter each session."

---

## 5. Build plan (phased) — you go first

### Phase Y0 — InsForge link + scaffold (do first, unblocks everyone)
- Confirm link: `npx @insforge/cli current` (project already linked — `electron`, app key `vs7g75mt`).
- `npm i @insforge/sdk`; create `lib/insforge/client.ts` (server-side `createClient`).
- Create the Next.js app shell if not present.
- **Success:** a trivial route can read/write InsForge.

### Phase Y1 — Schema + contract types (publish the shared surface)
- Write `insforge/migrations/0001_init.sql` for the 6 tables (§7 SQL is ready to paste) + the
  `confirmed` state is just a string value, no schema change. Add `reflex-evidence` private bucket.
- Write `lib/insforge/types.ts`: `Status` union, `IntakePayload`, `BugBriefDraft`, `StatusEvent`, and
  **re-export** `DispatchInput`/`EvidencePayload` (single import surface so Luke/Laurence align).
- **Success:** `npx @insforge/cli db migrations up` creates all tables; Laurence + Luke can import
  the types. Announce in Slack: "contracts live."

### Phase Y2 — `/api/intake` + observations (Laurence's unblock)
- Implement C1 intake → returns real `sessionId`; store media observations.
- **Success:** Laurence's `/reflex` creates a real persisted session.

### Phase Y3 — diagnose + brief + confirm
- Implement extraction + diagnosis (deterministic for the rehearsed transcript) → `BugBriefDraft`.
- Implement `/confirm` → `status=confirmed` → emit `DispatchInput` to Luke.
- **Success:** report → symptom → hypotheses → Slack confirm card → `confirmed`.

### Phase Y4 — status stream + evidence persistence
- `setStatus()` + `StatusEvent` publish; `GET /events` SSE + `GET /api/sessions/{id}` poll.
- Persist Luke's `EvidencePayload` (he writes `agent_runs`/`pull_requests`; you project status).
- **Success:** the whole chain `created → … → shipped` is visible via the status stream.

---

## 6. Mocking strategy (so you don't wait on the others)

- **Laurence:** test `/api/intake` with `examples/intake-sample.json` (the C1 shape) via `curl`.
- **Luke:** simulate `/api/replicas/callback` by POSTing a sample `EvidencePayload` (C4) — verify your
  status projection without Replicas running.
- **Model:** keep a `DIAGNOSIS_FIXTURE` env switch that returns the canned diagnosis for the rehearsed
  transcript, so diagnosis works offline.

## 7. Testing (TECHNICAL_DOCUMENT.md §14)
- Diagnosis contract validates required fields; role lens changes the generated brief (sales vs ceo
  vs engineer on the same screen → different symptom scope — this is the §18 closer, prove it in a test).
- Hypotheses always include a `reproductionPlan` + `expectedFailure` (Luke depends on these).
- State machine: only legal transitions; `confirmed` is required before any `DispatchInput` is emitted.
- Evidence persistence: a posted `EvidencePayload` creates `agent_runs` + `pull_requests` rows and
  flips status correctly, including `*_failed`.

## 8. Fallbacks (build / fake / name — TECHNICAL_DOCUMENT.md §13)

| Layer | Build (real) | Fake (scripted) | Name (roadmap) |
|---|---|---|---|
| Ingest/Storage | real InsForge persistence + bucket | pre-seeded session row (§12.5) | full redaction pipeline |
| Extraction | real vision call via gateway | cached `visible_state` for the demo screenshot | live multi-frame interpretation |
| Diagnosis | real model JSON | deterministic hardcoded diagnosis for the rehearsed transcript | open-ended any-repo diagnosis |
| Confirm | real Slack confirm → `confirmed` | auto-confirm | multi-approver workflow |
| Memory | seeded `memory_nodes` + match RPC | one seeded node | self-improving graph over time |

## 9. Demo ownership (TECHNICAL_DOCUMENT.md §12.5)
You own **session creation/persistence**, the **diagnosis + hypothesis tree**, and the **final
pipeline walkthrough** (walk the stored InsForge session states if anything live flakes). The §18
closer (role re-scope) is your diagnosis logic proving the role tag changes the engineering lens.

## 10. References
- Contracts: [`shared-contracts.md`](./shared-contracts.md) §2 (state machine), §3 (all contracts),
  §4 (schema ownership), §5 (storage), §6 (routes), §7 (env).
- Architecture: `TECHNICAL_DOCUMENT.md` §5 (role lenses), §6 (Observation/Extraction/Diagnosis/
  InsForge), §7 (data model + ready SQL), §8 (API surface), §14 (verification).
- API research: `STACK_RESEARCH.md` §3 (InsForge SDK/CLI/gateway/pgvector/realtime), §4 (periodic-
  screenshot extraction decision), §5 (SSE-not-WS on Vercel).
- Setup: InsForge project `electron` (app key `vs7g75mt`, us-west) already linked;
  `npx @insforge/cli current` to confirm.
