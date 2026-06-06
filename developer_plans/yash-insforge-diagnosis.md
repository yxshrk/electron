# Yash - InsForge, Diagnosis, and Debug Capture Storage

## Mission

Own the backend source of truth. Create the InsForge schema, run APIs, media/debug artifact storage,
bug report generation, confirmed intake package, diagnosis, and status stream.

Everyone depends on your contracts first. Ship `reflex_runs`, the run API, and shared types early so
Laurence and Luke can work against stable interfaces.

## Product Flow You Own

```text
Slack report context or recording capture
  -> reflex_runs row
  -> copied Slack messages and media_artifacts
  -> observations
  -> bug_briefs draft
  -> confirmed intake_packages row
  -> diagnoses + hypotheses
  -> run_events timeline
  -> dispatch handoff to Luke
```

The report path and record path are sibling paths. Do not replace `/reflex-report` with `/reflex-record`.

## What You Produce

| Output | Shape | Consumer |
| --- | --- | --- |
| InsForge schema | `reflex_runs`, `run_events`, `slack_context_messages`, `observations`, `media_artifacts`, `bug_briefs`, `intake_packages`, `diagnoses`, `hypotheses`, `agent_runs`, `pull_requests` | Everyone |
| Run API | `POST /api/runs` -> `{ runId, status, recordingUrl? }` | Laurence |
| Dashboard run list | `GET /api/runs` | Judges / teammates |
| Dashboard run detail | `GET /api/runs/{runId}` | Judges / teammates |
| Context ingest | `POST /api/runs/{runId}/context` | Laurence |
| Media ingest | `POST /api/runs/{runId}/media` | Laurence |
| Debug capture ingest | `POST /api/runs/{runId}/debug-capture` | Recorder |
| Report draft | `ReportDraft` | Laurence |
| Confirmed intake package | `IntakePackage` | Diagnosis + Luke |
| Diagnosis | symptom + hypotheses | Luke |
| Status events | `run_events` and `GET /api/runs/{runId}/events` | Laurence / dashboard |

## What You Consume

| Input | From | Purpose |
| --- | --- | --- |
| Run creation request | Laurence | Start bug or debug run |
| Slack context candidates | Laurence | Store the raw customer/report context |
| Slack file metadata | Laurence | Preserve screenshots/videos/recordings |
| Debug recording payload | Browser recorder | Store live reproduction evidence |
| Confirm/edit decision | Laurence | Create confirmed intake package |
| Evidence payload | Luke | Persist PR/reproduction output and status |

## Owned Files

```text
migrations/**
lib/insforge/client.ts
lib/insforge/types.ts
lib/insforge/status.ts
lib/diagnosis/prompts.ts
lib/diagnosis/report.ts
lib/diagnosis/diagnose.ts
app/debug/[runId]/page.tsx
app/dashboard/page.tsx
app/dashboard/[runId]/page.tsx
app/api/runs/route.ts
app/api/runs/[runId]/route.ts
app/api/runs/[runId]/context/route.ts
app/api/runs/[runId]/media/route.ts
app/api/runs/[runId]/debug-capture/route.ts
app/api/runs/[runId]/draft-bug-brief/route.ts
app/api/runs/[runId]/confirm-bug-brief/route.ts
app/api/runs/[runId]/intake-package/route.ts
app/api/runs/[runId]/diagnose/route.ts
app/api/runs/[runId]/events/route.ts
```

Luke owns the internals of `app/api/runs/[runId]/dispatch-replicas/route.ts` and
`app/api/replicas/callback/route.ts`, but both should write back through your persisted contracts.

## Run API

### `POST /api/runs`

Creates a `reflex_runs` row.

```ts
interface RunCreateInput {
  source: 'slack' | 'web' | 'manual';
  mode: 'bug' | 'debug';
  role: 'sales_csm' | 'ceo' | 'product' | 'engineer';
  repoUrl: string;
  commandText?: string;
  slackChannelId?: string;
  slackThreadTs?: string | null;
  contextWindow: {
    messageLimit: number;
    attachments: number;
    maxPromptChars: number;
  };
}
```

Defaults for the demo:

- `source = slack`
- `mode = bug` unless `/reflex-record`
- `role = sales_csm`
- `repoUrl = https://github.com/yxshrk/electron`
- `contextWindow.messageLimit = 100`
- `contextWindow.attachments = 3`
- `contextWindow.maxPromptChars = 6000`

Return:

```ts
{
  runId: string;
  status: 'created';
  recordingUrl?: string;
}
```

`recordingUrl` is only needed for the record path.

## Context and Media Ingest

### Report Path

`/reflex-report` sends copied Slack context once. Store it; do not ask the LLM whether to fetch more
history during the demo.

Store:

- raw message candidates in `slack_context_messages`
- optional transcript text in `observations`
- Slack files and copied storage URLs in `media_artifacts`
- status transition to `context_stored`

### Record Path

`/reflex-record` creates a run, then the browser recorder posts:

- screen recording
- audio recording
- screenshots or frames
- typed notes
- transcript if available

Store all artifacts in `media_artifacts` with `source = debug_capture`, and store text evidence in
`observations`.

## Bug Report Draft

`POST /api/runs/{runId}/draft-bug-brief` produces a compact report for the user to confirm.
Use the Bug Report Draft Prompt in `TECHNICAL_DOCUMENT.md` as the canonical template.

Fields:

```text
where_it_happens
actual_behavior
expected_behavior
reproduction_context
affected_surface
evidence_summary
missing_info
agent_prompt_preview
```

Use placeholders when the context is unclear. The point is not to be perfect; the point is to give
the user a fast confirmation gate before diagnosis and agent spend.

## Confirmed Intake Package

`POST /api/runs/{runId}/confirm-bug-brief` should:

1. Mark the selected `bug_briefs` row confirmed.
2. Create an `intake_packages` row containing the confirmed report, copied chat history, media
   artifact references, debug capture artifact references, and confirmation metadata.
3. Set `reflex_runs.status = package_confirmed`.

Diagnosis and Replicas must read the confirmed package. They should not build prompts from the
unconfirmed draft alone.

## Diagnosis

`POST /api/runs/{runId}/diagnose` consumes the confirmed intake package.
Use the Diagnosis Prompt in `TECHNICAL_DOCUMENT.md` as the canonical template.

Output:

- structured symptom
- evidence list
- ranked hypotheses
- each hypothesis has `reproductionPlan` and `expectedFailure`

For the rehearsed export-hang demo, keep a deterministic fixture or cached model output. The live
model path can exist, but the stage demo should not depend on nondeterministic prompt drift.

Role behavior:

- `sales_csm`: translate customer language into a reproducible engineering symptom.
- `ceo`: broaden into measurable product/workflow bottlenecks.
- `product`: treat the report as desired behavior or workflow gap.
- `engineer`: preserve technical specificity and skip business translation.

## Status Machine

Write all state transitions to `reflex_runs.status`:

```text
created -> context_stored -> clarifying -> report_drafted -> package_confirmed -> diagnosed -> dispatched -> reproduced -> fixed -> shipped
```

Failure states:

```text
clarification_failed
diagnosis_failed
dispatch_failed
reproduction_failed
pr_failed
```

Also append each state-changing transition to `run_events`.

Minimal event fields:

```text
event_type
status
title
detail
payload
actor
created_at
```

Laurence's Slack thread and the dashboard should render from `reflex_runs.status` plus `run_events`.
Do not keep timeline state only in Slack.

## Tiny Dashboard

Build the dashboard as a read-only inspection layer:

- `/dashboard`: list runs with status, mode, role, repo, symptom/report summary, diagnosis state, attachment count, PR link, and created time.
- `/dashboard/{runId}`: show confirmed report, Slack chat history, attachments, debug artifacts, diagnosis, hypotheses, selected hypothesis, `run_events`, agent evidence, and PR verification.
- No mutation buttons. Confirmation and dispatch stay in Slack/backend routes.

## Build Plan

1. Create the migration, `run_events`, and `lib/insforge` typed client.
2. Implement `POST /api/runs`.
3. Implement context, media, and debug capture ingest routes.
4. Implement `lib/diagnosis/prompts.ts`, report draft generation, and deterministic fixture support.
5. Implement confirmation and `intake_packages`.
6. Implement diagnosis and hypothesis creation.
7. Implement `run_events`, run status polling/events, and dashboard read endpoints.
8. Implement `/dashboard` and `/dashboard/{runId}`.
9. Provide sample payloads so Laurence and Luke can test without the full live flow.

## Demo Fallbacks

| Layer | Real Path | Fallback |
| --- | --- | --- |
| InsForge | Real tables and storage | Seeded rows and pre-uploaded artifacts |
| Bug report draft | Model-generated JSON | Deterministic fixture for export hang |
| Debug capture | Live browser recording | Pre-recorded upload |
| Diagnosis | Model-generated diagnosis | Cached symptom and hypotheses |
| Status/timeline | Real `run_events` | Seeded `run_events` rows |
| Dashboard | Live read-only InsForge data | Seeded run detail payload |

## References

- Shared contracts: [`shared-contracts.md`](./shared-contracts.md)
- Main technical plan: [`../TECHNICAL_DOCUMENT.md`](../TECHNICAL_DOCUMENT.md)
