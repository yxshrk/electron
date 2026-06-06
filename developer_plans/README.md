# Reflex Developer Plans

Per-person execution plans for Reflex, aligned with the current Slack-first technical plan in
[`../TECHNICAL_DOCUMENT.md`](../TECHNICAL_DOCUMENT.md).

Start with [`shared-contracts.md`](./shared-contracts.md). It is the interface spec for the team:
commands, route names, state names, payloads, schema ownership, env vars, and build order.

## Product Spine

```text
Path A: /reflex-report
  -> fetch latest 100 Slack message candidates + nearby attachments

Path B: /reflex-record
  -> browser recorder
  -> screen/audio recording + screenshots + notes

Shared tail:
  -> generated bug report
  -> Confirm / Edit Report / Add Attachment
  -> confirmed intake package
  -> diagnosis + hypotheses
  -> Replicas reproduction/fix
  -> GitHub PR
  -> tiny dashboard detail page shows stored context, timeline, evidence, and PR
```

Do not use the older `/reflex role:sales repo:...` command shape for the demo path. It is too
verbose for the first interaction and conflicts with the current UX.

## Team Split

| Owner | Slice | Plan | Responsibility |
| --- | --- | --- | --- |
| Laurence | Slack front door | [laurence-slack-intake.md](./laurence-slack-intake.md) | Slash commands, Slack thread UX, buttons, status cards |
| Yash | InsForge + diagnosis + capture storage + dashboard | [yash-insforge-diagnosis.md](./yash-insforge-diagnosis.md) | Schema, run source of truth, context/debug artifact ingest, bug report generation, diagnosis, dashboard read model |
| Luke | Seeded bug + Replicas + PR | [luke-replicas-dispatch-pr.md](./luke-replicas-dispatch-pr.md) | Deterministic export-hang fixture, dispatch confirmed hypotheses, collect evidence, open PR |

## Ground Rules

- Branch + PR for everything; never commit directly to `main`.
- Use `runId` and `reflex_runs` in new contracts. Do not introduce `sessionId` or `capture_sessions`.
- Use InsForge Postgres. Do not create a separate MySQL or Supabase database for the MVP.
- All entry points must converge on a confirmed intake package before diagnosis or Replicas dispatch.
- Contract changes go into [`shared-contracts.md`](./shared-contracts.md) first, then the owner plan.
