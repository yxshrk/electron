# lib/slack — Reflex Slack front door (Laurence's slice)

The human-facing Slack surface for the **Slack bug-mode MVP** (`developer_plans/laurence-slack-intake.md`,
`shared-contracts.md` on `docs/slack-bug-mode-mvp`). Two slash commands, auto-gathered context,
a confirmable report card, and a live status thread.

## Files
| File | Role |
|---|---|
| `contracts.ts` | wire types: `RunCreateInput` (C1), `ReportDraft` (C2), `IntakePackage` (C3), `RunEvent` (C6) |
| `verify.ts` | Slack request signature verification (replay-safe) |
| `context.ts` | gather latest N channel messages + attachments for bug mode |
| `blocks.ts` | Block Kit: ack, recorder button, status timeline, report card (Confirm/Edit/Add Attachment), edit modal, PR card |
| `client.ts` | Slack Web API (postMessage / update / views.open / files / conversations.history) |
| `backend.ts` | Yash's `/api/runs*`; `REFLEX_BACKEND=mock` (default) uses the scripted backend |
| `mock-backend.ts` | in-memory scripted backend + RunEvent replay |

Routes: `app/api/slack/{reflex-bug-mode,reflex-debug-mode,events,interactions}/route.ts`.

## Flow
```
/reflex-bug-mode   → createRun(mode:bug) → gather context → /context + /media
                   → draft-bug-brief → report card (Confirm / Edit Report / Add Attachment)
                   → confirm → status thread animates → PR card
/reflex-debug-mode → createRun(mode:debug) → Open Recorder button → (capture) → same report flow
```
IDs: `runId`. Status: created→context_stored→clarifying→report_drafted→package_confirmed→diagnosed→dispatched→reproduced→fixed→shipped.

## Test (no Next.js / no Slack)
```bash
npm run test:slack      # 26 assertions: verify, blocks, mock createRun→draft→confirm→shipped
```

## Notes
- `REFLEX_BACKEND=mock` (default) runs with zero backend. Flip it + set `NEXT_PUBLIC_APP_URL` to hit Yash's real `/api/runs`.
- Imports are **extensionless** (Next webpack doesn't resolve `.js`→`.ts` for value imports; `__mocks__` is also a webpack-ignored folder name — both avoided).
- Owned dirs `lib/slack/**` + `app/api/slack/**` are collision-free; root scaffold supersedes when Yash's lands.
