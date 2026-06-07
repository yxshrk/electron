# lib/slack — Reflex Slack front door (Laurence's slice)

The human-facing Slack surface. Two slash commands → run creation → confirmable report → live
status thread. Aligned to Yash's real `/api/runs` code (PR #8), not just the doc.

## Files
| File | Role |
|---|---|
| `contracts.ts` | wire types: `RunCreateInput` (C1), `ReportDraft` (C2), `IntakePackage` (C3), `RunEvent` (C6), media/context inputs |
| `verify.ts` | Slack request signature verification (replay-safe) |
| `context.ts` | gather latest N channel messages (+ attachment refs) for report mode |
| `blocks.ts` | Block Kit: ack, recorder button, status timeline, report card (Confirm/Edit/Add Attachment), edit modal, PR card |
| `client.ts` | Slack Web API (postMessage / update / views.open / files / conversations.history) |
| `backend.ts` | calls Yash's `/api/runs*`; `REFLEX_BACKEND=mock` (default) uses the scripted backend |
| `mock-backend.ts` | in-memory scripted backend + RunEvent replay |

Routes: `app/api/slack/{reflex-report,reflex-record,events,interactions}/route.ts`.

## Two flows
```
/reflex-report  → createRun(mode:bug) → gather channel context → POST /context
                → draft-bug-brief → REPORT CARD in Slack (Confirm / Edit Report / Add Attachment)
                → confirm-bug-brief → diagnose → dispatch top hypothesis → status thread animates → PR card
/reflex-record  → createRun(mode:debug) → "Open Recorder" link to /debug/{runId}
                → [browser recorder owns capture → draft; Slack Confirm starts diagnose + dispatch]
                → subscribe /events → status thread mirrors progress → PR card
```
IDs: `runId`. Status: created→context_stored→clarifying→report_drafted→package_confirmed→diagnosed→dispatched→reproduced→fixed→shipped.

## Confirmed wire shapes (matched to Yash PR #8, not the §8 doc)
- `POST /api/runs` ← `RunCreateInput` (source, mode, role, repoUrl, commandText?, slackChannelId?, slackThreadTs?, slackUserId?, contextWindow?)
- `POST /api/runs/{runId}/context` ← `{ messages:[{ ts, userId, text, permalink, hasFiles }] }` — **his route reads `ts`/`userId`** (the §8 doc's `slackMessageTs` is wrong); messages-only
- `POST /api/runs/{runId}/media` ← one file, `storageUrl` **required**; kinds = `screenshot|video|screen_recording|audio_recording|transcript|log|other`
- `POST /api/runs/{runId}/draft-bug-brief` → `ReportDraft` (body ignored; reads stored observation)
- `POST /api/runs/{runId}/confirm-bug-brief` ← `{ bugBriefId?, editedFields?, additionalMediaArtifactIds?, confirmedBy? }`
- `GET /api/runs/{runId}/events` → SSE **named event `run-event`** (+ `done`/`error`) → use `addEventListener`, not `onmessage`. PR url in `payload.prUrl`/`url` — parser tolerant of both.
- `evidenceSummary` is **object[]** `{kind, mediaArtifactId?, summary}` (§8, Yash-confirmed).

## Test (no Next.js / no Slack)
```bash
npm run test:slack      # 26 assertions: verify, blocks, mock createRun→draft→confirm→shipped
```

## Status / what works where
- **Report mode**: fully works on this branch with `REFLEX_BACKEND=mock` (the demo you saw).
- **Record mode**: posts the recorder link, but the `/debug/{runId}` page + the real run pipeline
  live in **Yash's PR #8** — not testable on this branch alone (see Integration).
- Attachment upload to Storage → `/media` is a TODO (needs `lib/insforge` from Yash).

## Integration (testing against Yash's real backend)
1. Merge this slice + Yash's PR #8 into one branch (so `/debug` page, `/api/runs/*`, `lib/insforge` exist).
2. Set InsForge env (`INSFORGE_PROJECT_URL`, `INSFORGE_SERVICE_KEY`, `OPENROUTER_API_KEY`) + `REFLEX_BACKEND` to hit the real routes, and `NEXT_PUBLIC_APP_URL` = the public tunnel/deploy URL (so the recorder link isn't localhost).
3. Then both report and record modes run end-to-end against InsForge.

## Notes
- `REFLEX_BACKEND=mock` (default) runs with zero backend. Imports are **extensionless** (Next webpack
  won't resolve `.js`→`.ts` for value imports; `__mocks__` is a webpack-ignored folder — both avoided).
- Owned dirs `lib/slack/**` + `app/api/slack/**` are collision-free with Yash's PR #8.
