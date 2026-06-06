# Reflex — Developer Plans

Per-person execution plans for **Reflex** (the InsForge Hackathon project — AI Nexus SF, June 6 2026).
Every plan is a vertical slice of the same pipeline, designed so the three of us can build
**simultaneously without colliding** and each know exactly what the rest of the app expects.

Read these in order:

1. **[shared-contracts.md](./shared-contracts.md)** — START HERE. The interface spec that binds all
   three slices: the contract chain (C1–C4), the state machine, the DB schema ownership, route +
   directory ownership (anti-collision map), env vars, and the parallel build order.
2. Your own plan (below).
3. [`../TECHNICAL_DOCUMENT.md`](../TECHNICAL_DOCUMENT.md) — the canonical architecture these plans
   refine. Section references (§N) throughout point back to it.

## The split

| Owner | Slice | Plan | Sits where in the pipeline |
|---|---|---|---|
| **Laurence** | Slack — the front door | [laurence-slack-intake.md](./laurence-slack-intake.md) | intake + status thread + confirm/edit UI |
| **Yash** | InsForge ingest + diagnosis + confirm-back | [yash-insforge-diagnosis.md](./yash-insforge-diagnosis.md) | the brain + the shared source of truth |
| **Luke** | Replicas dispatch + fix + PR | [luke-replicas-dispatch-pr.md](./luke-replicas-dispatch-pr.md) | reproduce → fix → green PR |

```text
Slack /reflex ─C1─► InsForge ingest ─► diagnose ─► confirm in Slack ─C3─► Replicas reproduce+fix ─C4─► PR
 (Laurence)          (Yash) ............................................. (Luke) ...................
                       ▲                                                    │
                       └──────────────── status events (C2) ───────────────┘ ──► Slack thread (Laurence)
```

## Important: this is a **re-assignment** of TECHNICAL_DOCUMENT.md §12.1

The canonical doc's owner table (§12.1) assigned Yash→capture UI, Luke→backend, Laurence→diagnosis/PR.
**This folder supersedes that** per the latest decision:

| | TECHNICAL_DOCUMENT.md §12.1 (old) | These plans (current) |
|---|---|---|
| Laurence | Diagnosis, reproduction, PR | **Slack intake + thread** |
| Yash | Screen capture UX | **InsForge ingest + diagnosis + confirm** |
| Luke | Next.js + InsForge backend | **Replicas dispatch + fix + PR** |

The architecture, data model, API surface, and state machine in §6–§12 still hold; only the
human ownership boundaries moved. Where a plan diverges from the doc (e.g. the new `confirmed`
state, Slack-first instead of web-first capture), it is called out inline.

## Existing code these plans build on

- `agent/replicas/*` (branch `laurence/replicas-dispatch`) — the Replicas dispatch scaffold +
  scripted fallback + the `DispatchInput`/`EvidencePayload` types. **→ becomes Luke's foundation.**
- `STACK_RESEARCH.md` (same branch) — verified sponsor API surfaces (Replicas REST, InsForge SDK,
  model gateway, Vercel/SSE). Cited throughout.

## Ground rules

- Branch + PR for everything; never commit to `main`. PRs are authored as `yxshrk`.
- One owner per file/route/table — see the ownership map in shared-contracts §6.
- A contract change is a message to the other two owners, then an edit to `shared-contracts.md`.
