# Reflex Shared Contracts

This is the anti-collision spec for the three workstreams. It is aligned with
[`../TECHNICAL_DOCUMENT.md`](../TECHNICAL_DOCUMENT.md).

## 1. Canonical Names

| Concept | Use | Do Not Use |
| --- | --- | --- |
| One Reflex run | `runId`, `reflex_runs` | `sessionId`, `capture_sessions` |
| Run timeline | `run_events` | UI-only status history |
| User-facing summary | `bug report` | long ticket form |
| Confirmed backend bundle | `intakePackageId`, `intake_packages` | raw prompt-only context |
| Existing-report entry | `/reflex-report` | `/reflex role:sales repo:...` |
| Live reproduction entry | `/reflex-record` | replacing the report path |

Both entry points must converge into one confirmed intake package before diagnosis, dispatch, or PR
work starts.

## 2. State Machine

Stored on `reflex_runs.status`.

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

Append every state-changing transition to `run_events` so Slack and `/dashboard/{runId}` can show a
complete timeline instead of only the latest state.

## 3. Commands

### `/reflex-report`

Use when the bug already exists in Slack context.

Behavior:

- Create a `bug` run.
- Fetch latest 100 channel messages as raw context candidates.
- Fetch latest 3 nearby Slack attachments.
- Store copied Slack context through `POST /api/runs/{runId}/context`.
- Draft a report and ask the user to confirm, edit, or add attachments.

### `/reflex-record`

Use when a user is actively reproducing the issue.

Behavior:

- Create a `debug` run.
- Return an Open Recorder link.
- Browser recorder captures screen, audio, screenshots, notes, and optional transcript.
- Store debug artifacts through `POST /api/runs/{runId}/debug-capture`.
- Draft the same report and use the same confirmation flow.

## 4. Contract Chain

> **Doc reconciliation — resolves TECHNICAL_DOCUMENT.md §8 vs §12.2 (the §8 shapes win):**
> 1. **Create carries no inline context.** `POST /api/runs` takes only the fields in C1 below — **no**
>    `chatHistoryMessages`/`mediaArtifacts` in the create body. Slack messages and files arrive via the
>    separate `POST /api/runs/{runId}/context` and `POST /api/runs/{runId}/media` endpoints. (§12.2's
>    inline-create payload is superseded.)
> 2. **`evidenceSummary` is `object[]`** `{ kind, mediaArtifactId?, summary }` (see C2), **not** `string[]`.
>
> Confirmed against the built backend: `lib/insforge/types.ts` (`RunCreateInput`, `EvidenceSummaryItem`)
> + the live `context`/`media` routes. Laurence's Slack slice (#6) is already aligned to this.

### C1: `RunCreateInput`

Laurence creates runs from Slack commands; Yash persists them.

```ts
interface RunCreateInput {
  source: 'slack' | 'web' | 'manual';
  mode: 'bug' | 'debug';
  role: 'sales_csm' | 'ceo' | 'product' | 'engineer';
  repoUrl: string;
  commandText?: string;
  slackChannelId?: string;
  slackThreadTs?: string | null;
  slackUserId?: string;
  contextWindow: {
    messageLimit: number;      // MVP default: 100
    attachments: number;       // MVP default: 3
    maxPromptChars: number;    // MVP default: 6000
  };
}
```

Returns:

```ts
{ runId: string; status: 'created'; recordingUrl?: string }
```

### C2: `ReportDraft`

Yash produces this after Slack context or debug artifacts are stored.

```ts
interface ReportDraft {
  runId: string;
  bugBriefId: string;
  status: 'needs_confirmation';
  whereItHappens: string;
  actualBehavior: string;
  expectedBehavior?: string;
  reproductionContext?: string;
  affectedSurface: 'frontend' | 'backend' | 'mobile' | 'infra' | 'unknown';
  evidenceSummary: Array<{ kind: string; mediaArtifactId?: string; summary: string }>;
  missingInfo: string[];
  agentPromptPreview: string;
}
```

Slack renders Confirm, Edit Report, and Add Attachment actions from this shape.

### C3: `IntakePackage`

Created only after user confirmation.

```ts
interface IntakePackage {
  runId: string;
  intakePackageId: string;
  bugBriefId: string;
  confirmedReport: Record<string, unknown>;
  chatHistoryMessageCount: number;
  mediaArtifactCount: number;
  debugArtifactCount: number;
  status: 'confirmed';
}
```

Diagnosis and Replicas must consume the confirmed intake package, not an unconfirmed draft.

### C4: `DispatchInput`

Yash sends this to Luke after `package_confirmed` and diagnosis.

```ts
interface DispatchInput {
  runId: string;
  intakePackageId: string;
  repoUrl: string;
  role: string;
  symptom: string;
  hypothesis: {
    id: string;
    title: string;
    reproductionPlan: string;
    expectedFailure: string;
  };
}
```

### C5: `EvidencePayload`

Luke returns this after Replicas or the scripted fallback produces evidence.

```ts
interface EvidencePayload {
  runId: string;
  hypothesisId: string;
  status: 'reproduced' | 'fixed' | 'shipped' | 'reproduction_failed' | 'pr_failed';
  rootCause: string;
  fixSummary: string;
  verification: string;
  logsUrl?: string;
  prUrl?: string;
  provider: 'replicas' | 'scripted';
}
```

### C6: `RunEvent`

Yash writes this on each state transition; Slack and the dashboard read it.

```ts
interface RunEvent {
  runId: string;
  eventType: string;
  status?: string;
  title: string;
  detail?: string;
  payload?: Record<string, unknown>;
  actor?: string;
  createdAt: string;
}
```

## 5. Route Ownership

| Route | Owner | Purpose |
| --- | --- | --- |
| `POST /api/slack/reflex-report` | Laurence | Slack report command |
| `POST /api/slack/reflex-record` | Laurence | Slack record command and recorder link |
| `POST /api/slack/events` | Laurence | Slack file/message events |
| `POST /api/slack/interactions` | Laurence | Confirm/Edit/Add Attachment actions |
| `POST /api/runs` | Yash | Create `reflex_runs` row |
| `GET /api/runs` | Yash | Read-only dashboard run list |
| `GET /api/runs/{runId}` | Yash | Read-only dashboard run detail bundle |
| `POST /api/runs/{runId}/context` | Yash | Store copied Slack context candidates |
| `POST /api/runs/{runId}/debug-capture` | Yash | Store recorder artifacts |
| `POST /api/runs/{runId}/media` | Yash | Store media artifact metadata |
| `POST /api/runs/{runId}/draft-bug-brief` | Yash | Generate confirmable report |
| `POST /api/runs/{runId}/confirm-bug-brief` | Yash | Confirm report and create package |
| `POST /api/runs/{runId}/intake-package` | Yash | Return confirmed intake package |
| `POST /api/runs/{runId}/diagnose` | Yash | Generate symptom and hypotheses from package |
| `POST /api/runs/{runId}/dispatch-replicas` | Luke | Dispatch confirmed hypothesis |
| `POST /api/replicas/callback` | Luke | Persist Replicas/scripted evidence |
| `GET /api/runs/{runId}/events` | Yash | Status stream for Slack and dashboard timeline |

## 6. Directory Ownership

```text
app/api/slack/**            -> Laurence
lib/slack/**                -> Laurence
app/dashboard/**            -> Yash
app/debug/**                -> Yash
app/api/runs/**             -> Yash, except dispatch-replicas -> Luke
app/api/replicas/**         -> Luke
lib/insforge/**             -> Yash
lib/diagnosis/**            -> Yash
lib/diagnosis/prompts.ts    -> Yash
agent/**                    -> Luke
agent/replicas/prompt.ts    -> Luke
migrations/**               -> Yash
developer_plans/**          -> all, but shared-contracts first
```

## 7. Storage

- Bucket: `reflex-evidence` private.
- Slack artifacts: `runs/{runId}/slack/{artifactKey}`.
- Debug artifacts: `runs/{runId}/debug/{artifactKey}`.
- Replicas evidence: `runs/{runId}/replicas/{artifactKey}`.

## 8. Environment Variables

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

## 9. Build Order

1. Yash creates the InsForge schema, typed client, `run_events`, and `POST /api/runs`.
2. Laurence creates `/reflex-report`, `/reflex-record`, and Slack interactions against mocked run APIs.
3. Yash implements context ingest, debug capture ingest, media storage, report draft, and intake package creation.
4. Yash implements diagnosis from confirmed intake packages.
5. Luke implements scripted fallback PR, then Replicas dispatch.
6. Yash implements `GET /api/runs`, `GET /api/runs/{runId}`, `GET /api/runs/{runId}/events`, `/dashboard`, and `/dashboard/{runId}`.
7. Laurence wires Slack status updates to the run event stream.
8. Everyone rehearses `/reflex-report` first; `/reflex-record` is a polish path if time allows.
