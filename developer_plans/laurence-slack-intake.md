# Laurence - Slack Front Door

## Mission

Own the human-facing Slack experience. Create the two Slack entry points, collect nearby context,
render the bug-report confirmation card, and keep the Slack thread updated until the PR appears.

You own Slack. You call Yash's run APIs. You do not call Luke directly.

## Product Flow You Own

```text
/reflex-report
  -> create bug run
  -> fetch latest 100 Slack message candidates
  -> fetch latest 3 nearby attachments
  -> send context and media metadata to Yash
  -> show generated report with Confirm / Edit Report / Add Attachment

/reflex-record
  -> create debug run
  -> show Open Recorder link
  -> when capture completes, show the same generated report confirmation card

After confirmation
  -> update the same Slack thread as status changes
  -> post the final PR link
```

## What You Produce

| Output | Route / Shape | Consumer |
| --- | --- | --- |
| Bug-mode run request | `POST /api/runs` with `mode: "bug"` | Yash |
| Record-path run request | `POST /api/runs` with `mode: "debug"` | Yash |
| Slack context candidates | `POST /api/runs/{runId}/context` | Yash |
| Slack file metadata | `POST /api/runs/{runId}/media` | Yash |
| User confirmation | `POST /api/runs/{runId}/confirm-bug-brief` | Yash |
| Slack status updates | One bot thread updated from `reflex_runs.status` and `run_events` | User / judges |

## What You Consume

| Input | From | Purpose |
| --- | --- | --- |
| `{ runId, status }` | `POST /api/runs` | Track the run |
| `ReportDraft` | `POST /api/runs/{runId}/draft-bug-brief` | Render confirmation card |
| `RunEvent` | `GET /api/runs/{runId}/events` or polling | Update Slack thread |
| PR URL | Status event or run state | Final Slack message |

## Owned Files

```text
app/api/slack/reflex-report/route.ts
app/api/slack/reflex-record/route.ts
app/api/slack/events/route.ts
app/api/slack/interactions/route.ts
lib/slack/client.ts
lib/slack/blocks.ts
lib/slack/context.ts
lib/slack/verify.ts
```

Use Yash's `lib/insforge` or API contracts for types, but do not edit the InsForge client, schema,
or diagnosis code.

## Command Behavior

### `/reflex-report`

Happy path:

```text
/reflex-report
```

Defaults:

- `role = sales_csm`
- `repoUrl = https://github.com/yxshrk/electron`
- latest 100 channel messages before the command are copied as raw candidates
- latest 3 nearby Slack attachments are copied as media candidates
- optional command text is a hint, not required

Implementation details:

- Ack Slack quickly.
- Create the run with `mode: "bug"`.
- Post one bot message and use that message thread for all later updates.
- Fetch context once. Do not implement the LLM "+10 more messages" loop for the demo.
- Send copied message records to `POST /api/runs/{runId}/context`.
- Send Slack file metadata and any uploaded storage URLs to `POST /api/runs/{runId}/media`.
- Ask Yash for `POST /api/runs/{runId}/draft-bug-brief`.
- Render a Block Kit card with Confirm, Edit Report, and Add Attachment.

### `/reflex-record`

Happy path:

```text
/reflex-record
```

Implementation details:

- Ack Slack quickly.
- Create the run with `mode: "debug"`.
- Return an Open Recorder button linked to `/debug/{runId}`.
- Recording happens in the browser because Slack cannot grant screen or microphone capture directly.
- After Yash stores the debug capture, reuse the same report confirmation UI.

## Confirmation UX

The confirmation card should show:

- where the bug happens
- actual behavior
- expected behavior if known
- affected surface
- evidence summary
- missing info placeholders
- agent prompt preview
- a short context line, for example: `Used /reflex-report, 8 channel messages, and 2 files`

Buttons:

- Confirm: calls `POST /api/runs/{runId}/confirm-bug-brief`
- Edit Report: opens a Slack modal and sends the edited fields to the same confirmation route
- Add Attachment: asks the user to upload another file, then re-renders the report

## Status Thread

Render these states from InsForge, not from local guesses. Use `run_events` for timeline details and
`reflex_runs.status` for the current state:

```text
created
context_stored
clarifying
report_drafted
package_confirmed
diagnosed
dispatched
reproduced
fixed
shipped
```

Failure states should show a concise failure line and keep the original context visible:

```text
clarification_failed
diagnosis_failed
dispatch_failed
reproduction_failed
pr_failed
```

## Build Plan

1. Create the Slack app with `/reflex-report`, `/reflex-record`, events, and interactions.
2. Implement request signature verification.
3. Implement `/reflex-report` against mocked `POST /api/runs`.
4. Add Slack history fetch and media metadata fetch.
5. Implement the confirmation Block Kit card and interactions.
6. Implement `/reflex-record` with Open Recorder link.
7. Wire status polling or events to update the Slack thread.
8. Rehearse the exact Slack-first demo path.

## Demo Fallbacks

| Layer | Real Path | Fallback |
| --- | --- | --- |
| Slack report command | Live `/reflex-report` | Static copied Slack message |
| Chat history | Latest 100 messages | Seeded context payload |
| Attachments | Slack files copied to InsForge | Pre-uploaded screenshot/video URL |
| Confirmation | Live Block Kit buttons | Preconfirmed report row |
| Status | Live thread updates | Manually replay status messages |

## References

- Shared contracts: [`shared-contracts.md`](./shared-contracts.md)
- Main technical plan: [`../TECHNICAL_DOCUMENT.md`](../TECHNICAL_DOCUMENT.md)
