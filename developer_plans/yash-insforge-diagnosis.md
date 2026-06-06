# Yash - InsForge, Diagnosis, and Debug Capture Storage

## Mission

Own the backend source of truth. Create the InsForge schema, run APIs, media/debug artifact storage,
bug report generation, confirmed intake package, diagnosis, and status stream.

Everyone depends on your contracts first. Ship `reflex_runs`, the run API, and shared types early so
Laurence and Luke can work against stable interfaces.

## Product Flow You Own

```text
Slack bug context or debug capture
  -> reflex_runs row
  -> copied Slack messages and media_artifacts
  -> observations
  -> bug_briefs draft
  -> confirmed intake_packages row
  -> diagnoses + hypotheses
  -> dispatch handoff to Luke
```

Bug mode and debug mode are sibling paths. Do not replace `/reflex-bug-mode` with debug mode.

## What You Produce

| Output | Shape | Consumer |
| --- | --- | --- |
| InsForge schema | `reflex_runs`, `slack_context_messages`, `observations`, `media_artifacts`, `bug_briefs`, `intake_packages`, `diagnoses`, `hypotheses`, `agent_runs`, `pull_requests` | Everyone |
| Run API | `POST /api/runs` -> `{ runId, status, recordingUrl? }` | Laurence |
| Context ingest | `POST /api/runs/{runId}/context` | Laurence |
| Media ingest | `POST /api/runs/{runId}/media` | Laurence |
| Debug capture ingest | `POST /api/runs/{runId}/debug-capture` | Recorder |
| Report draft | `ReportDraft` | Laurence |
| Confirmed intake package | `IntakePackage` | Diagnosis + Luke |
| Diagnosis | symptom + hypotheses | Luke |
| Status events | `GET /api/runs/{runId}/events` or pollable run state | Laurence |

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
lib/diagnosis/report.ts
lib/diagnosis/diagnose.ts
app/debug/[runId]/page.tsx
app/api/runs/route.ts
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
- `mode = bug` unless `/reflex-debug-mode`
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

`recordingUrl` is only needed for debug mode.

## Context and Media Ingest

### Bug Mode

`/reflex-bug-mode` sends copied Slack context once. Store it; do not ask the LLM whether to fetch more
history during the demo.

Store:

- raw message candidates in `slack_context_messages`
- optional transcript text in `observations`
- Slack files and copied storage URLs in `media_artifacts`
- status transition to `context_stored`

### Debug Mode

`/reflex-debug-mode` creates a run, then the browser recorder posts:

- screen recording
- audio recording
- screenshots or frames
- typed notes
- transcript if available

Store all artifacts in `media_artifacts` with `source = debug_capture`, and store text evidence in
`observations`.

## Bug Report Draft

`POST /api/runs/{runId}/draft-bug-brief` produces a compact report for the user to confirm.

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

Laurence's Slack thread and any optional Vercel status page should render from this source of truth.

## Build Plan

1. Create the migration and `lib/insforge` typed client.
2. Implement `POST /api/runs`.
3. Implement context, media, and debug capture ingest routes.
4. Implement report draft generation with deterministic fixture support.
5. Implement confirmation and `intake_packages`.
6. Implement diagnosis and hypothesis creation.
7. Implement run status polling/events.
8. Provide sample payloads so Laurence and Luke can test without the full live flow.

## Demo Fallbacks

| Layer | Real Path | Fallback |
| --- | --- | --- |
| InsForge | Real tables and storage | Seeded rows and pre-uploaded artifacts |
| Bug report draft | Model-generated JSON | Deterministic fixture for export hang |
| Debug capture | Live browser recording | Pre-recorded upload |
| Diagnosis | Model-generated diagnosis | Cached symptom and hypotheses |
| Status | Real events | Poll stored run row |

## References

- Shared contracts: [`shared-contracts.md`](./shared-contracts.md)
- Main technical plan: [`../TECHNICAL_DOCUMENT.md`](../TECHNICAL_DOCUMENT.md)
