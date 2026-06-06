# Reflex Demo Runbook

This runbook is the operational checklist for getting Reflex from Slack report to GitHub PR during
the hackathon demo. The system design lives in `TECHNICAL_DOCUMENT.md`; this file is the execution
path.

## Demo Spine

```text
/reflex-report
-> Slack command route
-> InsForge run + context storage
-> generated bug report
-> user confirms in Slack
-> confirmed intake package
-> diagnosis + hypotheses
-> scripted fallback or Replicas
-> GitHub PR
-> Slack thread + /dashboard/{runId}
```

Build `/reflex-report` first. Treat `/reflex-record` as optional until the report path reaches PR
three times in a row.

## P0 Ownership

| Area | Owner | Required output |
| --- | --- | --- |
| Slack command and thread UX | Laurence | `/reflex-report`, `/reflex-record`, Confirm/Edit/Add Attachment, status updates |
| InsForge backend and dashboard | Yash | schema, storage, run APIs, `run_events`, diagnosis, `/dashboard`, `/dashboard/{runId}` |
| Seeded bug and PR path | Luke | deterministic export-hang fixture, scripted fallback, Replicas handoff, PR |

## P0 Build Order

Build in this order so the team always has a demoable spine:

1. Seed the export-hang bug and scripted fallback PR path.
2. Apply the InsForge schema and create the `reflex-evidence` storage bucket.
3. Implement `POST /api/runs` and append-only `run_events`.
4. Implement `/reflex-report` with fixed Slack context fetch.
5. Draft the bug report and show Confirm/Edit/Add Attachment in Slack.
6. Add deterministic diagnosis fixture for the seeded export-hang bug.
7. Dispatch the scripted fallback or Replicas and open a PR.
8. Add `/dashboard/{runId}` so judges can inspect stored evidence.
9. Add `/dashboard` run list.
10. Rehearse the same flow three times.

Do not build `/reflex-record`, polished dashboard UI, Vercel deployment, or parallel Replicas fan-out
until steps 1 through 8 work reliably.

## Context Rules

For the demo, keep context collection deterministic:

- Fetch the latest 100 Slack channel messages before the `/reflex-report` command.
- Fetch the latest 3 nearby Slack files from those messages.
- Store all fetched messages and files in InsForge as raw context candidates.
- Summarize only the relevant subset into the prompt, capped at 6000 characters.
- Do not run an adaptive "fetch 10 more messages" loop during the demo.
- Let the Confirm/Edit/Add Attachment gate catch misunderstandings before diagnosis or agent spend.

## Environment

Required server-side env vars:

```text
NEXT_PUBLIC_APP_URL=
INSFORGE_PROJECT_URL=
INSFORGE_SERVICE_KEY=
SLACK_SIGNING_SECRET=
SLACK_BOT_TOKEN=
GITHUB_TOKEN=
DEFAULT_GITHUB_REPO=https://github.com/yxshrk/electron
MODEL_API_KEY=
REPLICAS_API_KEY=
REPLICAS_ENVIRONMENT_ID=
REPLICAS_WEBHOOK_SECRET=
```

For the first demo, `REPLICAS_API_KEY`, `REPLICAS_ENVIRONMENT_ID`, and `REPLICAS_WEBHOOK_SECRET`
can be empty if the scripted fallback path is working.

## InsForge Setup

1. Link the project:

   ```bash
   npx @insforge/cli login
   npx @insforge/cli link
   npx @insforge/cli current
   ```

2. Apply migrations:

   ```bash
   npx @insforge/cli db migrations list
   npx @insforge/cli db migrations up --all
   ```

   If the installed CLI uses a different migration command, use the equivalent InsForge migration
   command or apply the SQL from the InsForge dashboard. The required result is the table list below,
   not a specific command shape.

3. Create storage bucket:

   ```bash
   npx @insforge/cli storage create-bucket reflex-evidence --private
   ```

   If the storage command is unavailable in the installed CLI, create a private bucket named
   `reflex-evidence` from the InsForge dashboard or equivalent storage UI.

4. Verify required tables exist:

   ```text
   reflex_runs
   run_events
   slack_context_messages
   observations
   media_artifacts
   bug_briefs
   intake_packages
   diagnoses
   hypotheses
   agent_runs
   pull_requests
   ```

## Slack App Setup

Required bot scopes:

```text
commands
chat:write
files:read
files:write
channels:history
groups:history
```

Request URLs:

```text
/reflex-report -> {NEXT_PUBLIC_APP_URL}/api/slack/reflex-report
/reflex-record -> {NEXT_PUBLIC_APP_URL}/api/slack/reflex-record
Interactivity -> {NEXT_PUBLIC_APP_URL}/api/slack/interactions
Events -> {NEXT_PUBLIC_APP_URL}/api/slack/events
```

Minimal Slack manifest:

```yaml
display_information:
  name: Reflex
features:
  bot_user:
    display_name: reflex
  slash_commands:
    - command: /reflex-report
      url: https://YOUR_APP_URL/api/slack/reflex-report
      description: Create a Reflex bug report from nearby Slack context
      usage_hint: "[optional context]"
    - command: /reflex-record
      url: https://YOUR_APP_URL/api/slack/reflex-record
      description: Record a live reproduction for Reflex
      usage_hint: "[optional context]"
oauth_config:
  scopes:
    bot:
      - commands
      - chat:write
      - files:read
      - files:write
      - channels:history
      - groups:history
settings:
  interactivity:
    is_enabled: true
    request_url: https://YOUR_APP_URL/api/slack/interactions
  event_subscriptions:
    request_url: https://YOUR_APP_URL/api/slack/events
    bot_events:
      - file_shared
      - message.channels
```

## Seeded Bug Implementation Spec

Primary demo bug:

```text
Large report export hangs or crashes.
```

Required behavior:

```text
before fix: large export hangs, times out, or crashes
after fix: same export completes under demo timeout
```

Suggested file contract once the app scaffold exists:

| File | Purpose |
| --- | --- |
| `lib/demo/report-fixture.ts` | Generate a deterministic large report dataset |
| `lib/reports/export.ts` | Export implementation with the intentional unbounded/synchronous bug |
| `app/reports/page.tsx` | Demo UI with an Export button and loading state |
| `tests/report-export.spec.ts` | Failing repro before fix, passing verification after fix |
| `agent/replicas/scripted-fallback.ts` | Applies known minimal fix and opens PR |
| `agent/examples/dispatch-input.json` | Demo `DispatchInput` for export-hang hypothesis |

Failing repro command:

```bash
npm run test:export-large:repro
```

Expected before-fix output:

```text
FAIL report export completes for a large dataset
Expected export to finish under demo timeout, but it timed out or left the spinner active.
```

Known minimal fix:

```text
Replace unbounded/synchronous export with a bounded batched or streaming path.
Keep UI behavior minimal: either complete export or show progress without crashing.
```

Verification command:

```bash
npm run test:export-large:fixed
```

Expected after-fix output:

```text
PASS report export completes for a large dataset
```

Scripted fallback command:

```bash
npm run reflex:scripted-fallback -- agent/examples/dispatch-input.json
```

This command runs in dry-run mode by default so it can be used safely during development. To create
the fallback fix branch and PR, run:

```bash
npm run reflex:scripted-fallback:create -- agent/examples/dispatch-input.json
```

Scripted fallback must:

- create a fresh branch
- run the failing repro and capture output
- apply the known minimal fix
- run verification
- open a PR
- return an `EvidencePayload`

## API Build Checklist

The implementation should expose these routes before the demo script is rehearsed:

| Route | Required behavior |
| --- | --- |
| `POST /api/slack/reflex-report` | Ack Slack quickly, create a `bug` run, fetch Slack context, start drafting |
| `POST /api/slack/reflex-record` | Ack Slack quickly, create a `debug` run, return recorder URL |
| `POST /api/slack/events` | Receive optional Slack file/message events |
| `POST /api/slack/interactions` | Handle Confirm/Edit/Add Attachment actions |
| `POST /api/runs` | Create or return the normalized Reflex run |
| `POST /api/runs/{runId}/context` | Store copied Slack messages and file references |
| `POST /api/runs/{runId}/media` | Store artifact metadata after upload to InsForge Storage |
| `POST /api/runs/{runId}/debug-capture` | Store recording, transcript, screenshot, and note artifacts |
| `POST /api/runs/{runId}/draft-bug-brief` | Generate confirmable bug report from stored context |
| `POST /api/runs/{runId}/confirm-bug-brief` | Confirm or update the bug brief, create the intake package, diagnose, and auto-dispatch |
| `POST /api/runs/{runId}/intake-package` | Return the confirmed source-of-truth package |
| `POST /api/runs/{runId}/diagnose` | Generate symptom and hypotheses from confirmed package only |
| `POST /api/runs/{runId}/dispatch` | Select the top hypothesis and forward it to Replicas/scripted fallback |
| `POST /api/runs/{runId}/dispatch-replicas` | Start Replicas or scripted fallback for one selected hypothesis |
| `POST /api/replicas/callback` | Store agent evidence, PR metadata, and Slack/dashboard status |
| `GET /api/runs` | Return shallow run list for `/dashboard` |
| `GET /api/runs/{runId}` | Return complete evidence bundle for `/dashboard/{runId}` |
| `GET /api/runs/{runId}/events` | Return ordered `run_events` for timeline rendering |

Every mutating route should write a `run_events` row when it changes the externally visible state.

## Core API Smoke Tests

Create run:

```bash
curl -X POST "$NEXT_PUBLIC_APP_URL/api/runs" \
  -H "Content-Type: application/json" \
  -d '{
    "source": "slack",
    "mode": "bug",
    "role": "sales_csm",
    "repoUrl": "https://github.com/yxshrk/electron",
    "commandText": "",
    "slackChannelId": "C_DEMO",
    "slackThreadTs": null,
    "contextWindow": {
      "messageLimit": 100,
      "attachments": 3,
      "maxPromptChars": 6000
    }
  }'
```

Draft report:

```bash
curl -X POST "$NEXT_PUBLIC_APP_URL/api/runs/$RUN_ID/draft-bug-brief" \
  -H "Content-Type: application/json" \
  -d '{
    "includeSlackHistory": true,
    "messageLimit": 100,
    "includeAttachments": true,
    "attachmentLimit": 3,
    "includeDebugCapture": true,
    "maxPromptChars": 6000
  }'
```

Confirm report. In the default demo config, this also diagnoses the report, dispatches the top
hypothesis, writes `agent_runs` / `pull_requests`, and advances the Slack timeline to PR opened.

```bash
curl -X POST "$NEXT_PUBLIC_APP_URL/api/runs/$RUN_ID/confirm-bug-brief" \
  -H "Content-Type: application/json" \
  -d '{
    "bugBriefId": "brief_run_export_hang_01",
    "editedFields": null,
    "additionalMediaArtifactIds": [],
    "confirmedBy": "U_DEMO"
  }'
```

Manual diagnose retry:

```bash
curl -X POST "$NEXT_PUBLIC_APP_URL/api/runs/$RUN_ID/diagnose" \
  -H "Content-Type: application/json" \
  -d '{ "intakePackageId": "pkg_run_export_hang_01" }'
```

Manual top-hypothesis dispatch retry:

```bash
curl -X POST "$NEXT_PUBLIC_APP_URL/api/runs/$RUN_ID/dispatch" \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "scripted",
    "createPr": true
  }'
```

## Demo Script

1. Seed Slack channel with a customer report:

   ```text
   Customer says large report export hangs and then the frontend crashes.
   ```

2. Attach or reference the export screenshot/video if available.

3. Run:

   ```text
   /reflex-report
   ```

4. Show Slack bot status:

   ```text
   created -> context_stored -> report_drafted
   ```

5. Show generated report:

   ```text
   Where: Report export screen
   Actual: Large export hangs or crashes
   Expected: Export completes or shows progress
   Surface: frontend
   Evidence: Slack report + attachment
   ```

6. Click Confirm.

7. Show diagnosis:

   ```text
   Symptom: Report export hangs on large datasets
   Hypothesis: Unbounded report query
   ```

8. Trigger scripted fallback or Replicas dispatch.

9. Show reproduction evidence:

   ```text
   before fix: report export test fails or times out
   after fix: report export test passes
   ```

10. Open PR from Slack thread.

11. Open:

   ```text
   /dashboard/{runId}
   ```

12. Show stored data:

   ```text
   confirmed report
   Slack chat history
   attachments
   run_events timeline
   diagnosis
   hypotheses
   agent evidence
   PR metadata
   ```

## Dashboard Field Map

`/dashboard`:

| Field | Source |
| --- | --- |
| Run ID | `reflex_runs.run_key` |
| Status | `reflex_runs.status` |
| Mode | `reflex_runs.mode` |
| Role | `reflex_runs.role` |
| Repo | `reflex_runs.repo_url` |
| Summary | latest `diagnoses.symptom` or confirmed report actual behavior |
| Diagnosis state | `diagnoses.id` exists or not |
| Attachment count | count of `media_artifacts` for run |
| PR link | latest `pull_requests.github_url` |
| Created time | `reflex_runs.created_at` |

`/dashboard/{runId}`:

| Section | Source |
| --- | --- |
| Confirmed report | `intake_packages.confirmed_report` |
| Chat history | `slack_context_messages` or `intake_packages.chat_history` |
| Attachments | `media_artifacts` and `intake_packages.media_artifacts` |
| Debug artifacts | `intake_packages.debug_capture_artifacts` |
| Timeline | `run_events` ordered by `created_at` |
| Diagnosis | `diagnoses` |
| Hypotheses | `hypotheses` |
| Agent evidence | `agent_runs.result`, `agent_runs.logs_url` |
| PR metadata | `pull_requests` |

## Run Event Contract

Use stable event names so Slack and the dashboard tell the same story:

| Event type | Status after event | Required payload |
| --- | --- | --- |
| `run.created` | `created` | `runId`, `mode`, `role`, `repoUrl` |
| `context.stored` | `context_stored` | `messageCount`, `attachmentCount` |
| `report.drafted` | `report_drafted` | `bugBriefId`, `missingInfoCount` |
| `package.confirmed` | `package_confirmed` | `intakePackageId`, `confirmedBy` |
| `diagnosis.created` | `diagnosed` | `diagnosisId`, `hypothesisCount` |
| `agent.dispatched` | `dispatched` | `agentRunId`, `provider`, `taskName` |
| `agent.reproduced` | `reproduced` | `agentRunId`, `failingCommand`, `evidenceUrl` |
| `agent.fixed` | `fixed` | `agentRunId`, `passingCommand`, `verification` |
| `pr.opened` | `shipped` | `githubUrl`, `branch`, `rootCause` |

Slack thread updates and dashboard timeline rows should both render from these events.

## Idempotency and Retry Rules

Slack retries:

- Use Slack retry headers and event IDs to avoid duplicate run creation.
- If the same slash command retry arrives, return the existing `runId`.
- Ack slash commands and interactions within Slack's timeout, then continue work asynchronously.

Context ingest:

- Store each Slack message once per `run_id` + `slack_message_ts`.
- Store each Slack file once per `run_id` + `slack_file_id`.
- Re-running context ingest for the same run should update counts, not duplicate rows.

Confirmation:

- Confirm button is idempotent.
- If `intake_packages.status = confirmed`, return the existing package.
- Do not create a second package for a duplicate Confirm click unless the user submitted edits.

Dispatch:

- Only dispatch if `reflex_runs.status = diagnosed`.
- Set status to `dispatched` before starting external work.
- Reject or no-op duplicate dispatch for the same `run_id` + `hypothesis_id`.
- Allow explicit manual retry only by creating a new `agent_runs` row with a new retry suffix.

Callbacks:

- Treat callback retries as idempotent by provider event ID, task name, or `agentRunId`.
- Do not create duplicate PR rows for the same `run_id` + `github_url`.
- Status can move forward only: `dispatched -> reproduced -> fixed -> shipped`.

## Fallbacks

| Failure | Fallback |
| --- | --- |
| Slack command fails | Use API smoke test curl to create and advance a run |
| Slack history fetch fails | Use seeded `slack_context_messages` rows |
| File upload fails | Use pre-uploaded `media_artifacts` rows |
| Model output drifts | Use deterministic export-hang diagnosis fixture |
| Replicas is unavailable | Use scripted fallback PR |
| GitHub PR creation is slow | Show pre-opened fallback PR |
| Dashboard not deployed | Use local dashboard or direct InsForge table view |

## Rehearsal Gate

Do not demo live until this passes three times:

```text
/reflex-report
-> generated report
-> Confirm
-> diagnosis
-> scripted fallback or Replicas
-> PR
-> /dashboard/{runId}
```

Each rehearsal must produce:

- one `reflex_runs` row
- ordered `run_events`
- copied Slack context
- confirmed intake package
- diagnosis and at least one hypothesis
- reproduction evidence
- PR URL
- dashboard detail page showing the same run
