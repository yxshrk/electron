# Reflex Technical Document

## 1. Project Summary

Reflex is a role-aware debugging assistant for agentic software development. A user starts from either Slack bug mode or live debug mode, optionally attaches screen context, and Reflex converts the captured context into a structured engineering symptom. Reflex then dispatches coding agents to reproduce the issue in sandboxed environments and opens a pull request with evidence that the bug was reproduced and fixed.

The demo target is the InsForge Hackathon hosted by AI Nexus in San Francisco on June 6, 2026. The event is focused on agentic developer tools, coding agents, autonomous workflows, agent infrastructure, and AI-native engineering systems. The fastest demo implementation is Slack-first: Slack owns the primary user experience, a small webhook/API layer owns orchestration, and InsForge owns the Postgres database, storage, realtime-capable state, and backend project context.

One-line judge pitch:

> Use `/reflex-bug-mode` when the bug already exists in Slack, or `/reflex-debug-mode` when someone needs to record a live reproduction. Both paths produce the same confirmed intake package, then Reflex dispatches a coding agent and returns a PR with reproduction evidence.

## 2. Problem Statement

The people who encounter product failures are often not the engineers who can fix them. Sales, support, founders, and product managers describe symptoms in human terms, while engineering teams need reproducible technical evidence. The current handoff is slow and lossy:

- The bug reporter writes an imprecise ticket.
- Engineering asks for reproduction steps.
- Context is lost between screen recordings, logs, customer impact, and code changes.
- Multiple engineers may investigate the wrong root cause before a fix is proven.

Reflex collapses this gap by treating the original screen-and-voice moment as the source of truth, translating it through the correct role lens, and requiring sandbox reproduction before any fix is considered valid.

## 3. Goals

- Start a bug run from one Slack command.
- Support two entry points: Slack bug mode for existing customer reports and debug mode for live reproduction capture.
- Capture the triggering Slack context, optional message text, recordings, screenshots, transcripts, and attachments.
- Convert vague user language into a structured technical symptom.
- Generate a ranked hypothesis tree tied to codebase context.
- Dispatch a Replicas coding-agent task to reproduce the top hypothesis, with parallel fan-out as a stretch.
- Record reproduction evidence before writing or accepting a fix.
- Open a pull request linked to the original report, reproduction trace, and fix summary.
- Provide a tiny read-only dashboard so judges can inspect runs, diagnoses, chat history, attachments, evidence, and PR output.
- Demonstrate sponsor usage in load-bearing parts of the architecture.

## 4. Non-Goals

- Fully robust always-on screen monitoring or a full web recording product.
- Open-ended natural conversation across arbitrary applications.
- Multi-tenant enterprise administration.
- Production-grade privacy redaction for all screen content.
- Guaranteed fix generation for arbitrary repos.
- Native mobile reproduction in the MVP. Limrun is an optional mobile extension.

For the hackathon, Reflex should optimize for a reliable end-to-end spine on one seeded repository and one or two rehearsed symptoms.

## Fastest Demo Stack

The fastest credible version is:

```text
Slack + InsForge + Replicas + GitHub API
```

Do not add MySQL or Supabase for the MVP. InsForge Postgres is the database, and InsForge Storage is the artifact store. InsForge already provides the backend layer Reflex needs: Postgres database, authentication, storage, realtime, edge functions, and model gateway support. Using InsForge also strengthens the hackathon story because Reflex becomes an InsForge-powered agentic developer tool instead of a generic Slack bot with a separate database provider.

| Layer | Tool | Responsibility |
| --- | --- | --- |
| Primary UI | Slack | Slash command, thread updates, screenshot or recording attachments, final PR link |
| Intake API | Minimal webhook/API layer | Receive Slack commands/events and normalize reports |
| Orchestration | Minimal webhook/API layer | Draft bug report, collect confirmation, create diagnosis, dispatch agent work, update run state |
| Database | InsForge Postgres | Runs, observations, diagnoses, hypotheses, agent runs, PR metadata |
| File storage | InsForge Storage | Screenshots, videos, recordings, logs, reproduction evidence |
| Live updates | Slack thread updates | Show observe, diagnose, dispatch, reproduce, fix, and ship status |
| AI/model access | InsForge Model Gateway or direct model API | Draft bug report and generate diagnosis JSON |
| Agent execution | Replicas | Run sandboxed background coding tasks and produce fix evidence |
| PR output | GitHub API | Create branches, commits, and pull requests |
| Demo visibility UI | Vercel / Next.js | Tiny read-only `/dashboard` and `/dashboard/{runId}` pages for judges |

Minimum demo loop:

```text
Entry point A: Slack /reflex-bug-mode command
or
Entry point B: Slack /reflex-debug-mode command -> browser capture page -> Done
-> /api/slack/reflex-bug-mode or /api/slack/reflex-debug-mode
-> InsForge stores run state
-> Reflex fetches nearby Slack chat history and attachment metadata when Slack context exists
-> InsForge stores chat context and attachment records
-> Reflex stores debug recording, transcript, screenshots, and uploaded artifacts when debug mode is used
-> /api/runs/{runId}/draft-bug-brief creates a compact bug report
-> user confirms, edits, or adds more attachments in Slack
-> InsForge stores the confirmed intake package
-> /api/runs/{runId}/diagnose creates structured symptom
-> /api/runs/{runId}/dispatch-replicas starts a Replicas task or scripted sandbox fallback
-> InsForge stores run status and evidence
-> GitHub PR opens
-> Slack bot update thread shows the PR
-> tiny dashboard lists the run and shows the confirmed report, chat history, attachments, diagnosis, evidence, and PR
```

MVP command defaults:

```text
Bug command: /reflex-bug-mode
Debug command: /reflex-debug-mode
Default role: sales_csm
Default repo: https://github.com/yxshrk/electron
Default Slack context fetch cap: latest 100 messages in the current Slack channel before the command
Default media: latest 3 Slack attachments near those messages
Default prompt context: relevant summary and strongest evidence only, about 6000 characters
```

The user should not need to type `role`, `repo`, or a long bug description during the demo. Optional command text can be included, but the happy path is just:

```text
/reflex-bug-mode
```

Debug mode has a separate happy path:

```text
/reflex-debug-mode
-> open recorder
-> record screen and audio while reproducing the issue
-> Done
```

Do not use an adaptive "ask the LLM if more history is needed, then fetch +10" loop for the demo. Fetch 100 messages once, store them as raw context candidates, summarize/select the relevant subset for the report prompt, and let the user confirmation gate catch misunderstandings.

Slack implementation note:

```text
Custom Slack slash commands are channel-level app entry points, not thread entry points. For the MVP, run `/reflex-bug-mode` in the channel right after the customer report. Reflex then creates its own Slack update thread from the bot response. `/reflex-debug-mode` can also start from Slack, but recording itself happens in a browser capture page because Slack cannot directly grant screen or microphone capture to the app. If the team wants true thread/message-level start later, add Slack message shortcuts named "Start Reflex Bug Mode" and "Start Reflex Debug Mode" that map into the same `/api/runs` payload.
```

### Hackathon Sponsor Usage

The MVP should use sponsors where they are load-bearing, not decorative.

| Sponsor / Partner | MVP Role | Optional Role |
| --- | --- | --- |
| InsForge | Backend source of truth: Postgres, Storage, Realtime/polling, optional Model Gateway | Diagnostic memory graph and richer model routing |
| Vercel | Host the webhook/API and tiny read-only dashboard if the team deploys on Vercel | Fuller dashboard and v0-generated UI |
| Replicas | Primary sandboxed coding-agent execution layer | Parallel hypothesis fan-out and CI/code-review feedback loops |
| Cognition / Devin | Not required for first demo | Second agent path for confirmed implementation work |
| Limrun | Not required for web-first MVP | Mobile reproduction path for iOS/Android bug reports |
| AI Nexus | Hackathon host/community context | No technical integration |
| Entrepreneur First | Startup/community context | No technical integration |

Vercel should stay out of the main product interaction path for the first demo. Slack can be the primary user interface. A tiny read-only dashboard is still useful for judges because it makes the stored InsForge data visible:

```text
/dashboard lists all Reflex runs and diagnoses.
/dashboard/{runId} shows the confirmed report, chat history, attachments, debug artifacts, diagnosis, hypotheses, agent evidence, timeline, and PR link.
```

Limrun should also stay out of the main demo path unless the team intentionally switches to a mobile bug. The correct positioning is:

```text
If the reported issue is mobile, Reflex routes reproduction into Limrun so agents can build, run, and preview the app through remote Xcode builds, iOS simulators, Android emulators, and browser-shareable mobile previews.
```

## 5. User Roles and Diagnostic Lenses

The role is not cosmetic. It determines translation depth, prompt framing, hypothesis scope, and agent instructions. For the Slack-first MVP, the role defaults to `sales_csm` so the user does not need to type it during the demo. Optional overrides can be added later.

| Role | User Input Style | Reflex Interpretation | Agent Brief |
| --- | --- | --- | --- |
| Sales / CSM | Customer-facing complaint | Map symptom to reproducible technical fault | Find user-visible failure and prove it |
| CEO / Founder | Strategic or business frustration | Decompose into candidate engineering causes | Identify measurable product bottleneck |
| Product | Desired behavior or workflow gap | Treat as feature specification | Scaffold implementation plan or PR |
| Engineer | Technical symptom | Skip business translation | Reproduce, localize, and patch directly |

Example:

- Sales says: "Every time this customer exports the big report, it hangs."
- Reflex produces: "Report generation hangs for large datasets; likely unbounded query, missing pagination, or timeout."
- Engineer says on the same screen: "Export endpoint times out on large datasets."
- Reflex produces: "Reproduce timeout on export endpoint with large dataset fixture; inspect query path and request timeout handling."

## 6. System Architecture

```mermaid
flowchart LR
    Slack["Slack /reflex-bug-mode"] --> SlackAPI["/api/slack/reflex-bug-mode"]
    DebugSlack["Slack /reflex-debug-mode"] --> DebugAPI["/api/slack/reflex-debug-mode"]
    DebugAPI --> Capture["Browser recorder /debug/{runId}"]
    Capture --> DebugUpload["POST /api/runs/{runId}/debug-capture"]
    DebugUpload --> Storage
    DebugUpload --> DB
    SlackFile["Slack screenshot/recording attachment"] --> SlackAPI
    SlackAPI --> RunCreate["POST /api/runs"]
    DebugAPI --> RunCreate
    RunCreate --> DB["InsForge Postgres"]
    RunCreate --> Storage["InsForge Storage"]
    SlackAPI --> Context["POST /api/runs/{runId}/context"]
    Context --> DB
    SlackFile --> Media["POST /api/runs/{runId}/media"]
    Media --> Storage
    Media --> DB
    DB --> Brief["POST /api/runs/{runId}/draft-bug-brief"]
    Brief --> Confirm["Slack confirm/edit/add attachment"]
    Confirm --> ConfirmAPI["POST /api/slack/interactions"]
    ConfirmAPI --> Package["POST /api/runs/{runId}/intake-package"]
    Package --> DB
    Package --> Diagnose["POST /api/runs/{runId}/diagnose"]
    Diagnose --> Model["InsForge Model Gateway or direct LLM"]
    Diagnose --> Hypotheses["Hypotheses + reproduction plan"]
    Hypotheses --> Dispatch["POST /api/runs/{runId}/dispatch-replicas"]
    Dispatch --> Agent["Replicas task or scripted sandbox"]
    Agent --> Callback["POST /api/replicas/callback"]
    Callback --> Evidence["Reproduction evidence + fix"]
    Evidence --> DB
    Evidence --> Storage
    Evidence --> GitHub["GitHub PR"]
    DB --> SlackUpdate["Slack thread updates"]
    GitHub --> SlackUpdate
    DB --> Dashboard["Tiny dashboard /dashboard and /dashboard/{runId}"]
```

### 6.1 Components

#### Slack Intake

Purpose: Provide the primary product surface for the MVP.

Responsibilities:

- Receive `/reflex-bug-mode` slash commands.
- Receive `/reflex-debug-mode` slash commands as a separate entry point.
- Default the MVP role to `sales_csm` and repo to `https://github.com/yxshrk/electron`.
- Treat optional command text as a hint, not as a required form.
- For bug mode, read the latest 100 channel messages before the command and latest 3 nearby attachments as raw context candidates.
- For debug mode, create a run and return an "Open Recorder" link to the browser capture page.
- Copy fetched chat history and attachment metadata into InsForge before drafting.
- Accept screenshots or recordings as Slack attachments when available.
- Ask the user to confirm, edit, or add attachments to a compact bug report before diagnosis starts.
- Reply with a bot message and use that message thread for pipeline status.
- Show the final PR link in the same thread.

Hackathon discipline:

- Slack is the user interface for the first demo.
- Do not block the Slack command response while agent work runs.
- Store status in InsForge, then update the Slack thread as each stage completes.

#### Debug Capture Mode

Purpose: Let a user reproduce a bug live when the useful evidence is not already in Slack.

Responsibilities:

- Start from `/reflex-debug-mode`.
- Open a browser capture page for screen recording, microphone recording, screenshots, and typed notes.
- Store recordings, transcripts, screenshots, and notes in InsForge Storage and Postgres when the user clicks Done.
- Generate the same bug report confirmation message used by bug mode.
- Continue into the same confirmed intake package, diagnosis, Replicas dispatch, and PR flow.

Hackathon discipline:

- Debug mode is a sibling entry point, not a replacement for `/reflex-bug-mode`.
- Keep the capture UI minimal: Start Recording, Stop, Done, and optional Add Attachment.
- If recording is too risky for the demo, use a pre-recorded video upload and still route it through the same `debug` mode package.

#### Clarification Gate

Purpose: Turn messy Slack history into a confirmed, compact bug report before spending tokens on diagnosis or agent execution.

Responsibilities:

- Read the slash command, fetched Slack context candidates, debug recordings/transcripts, and latest attachment metadata records.
- Include screenshots and videos as evidence artifacts, copied into InsForge Storage when possible.
- Generate a short bug report with placeholders for unclear details.
- Ask the user to confirm, edit the report, or add more attachments in Slack.
- Block diagnosis until the bug report is confirmed.
- Store both the draft and confirmed report in InsForge.

Bug report fields:

```text
where_it_happens
actual_behavior
expected_behavior
reproduction_context
affected_surface
evidence_summary
user_role
repo_url
missing_info
agent_prompt_preview
```

Hackathon discipline:

- The clarification step should ask for confirmation, not start a long chat.
- Use one Slack message with Confirm, Edit Report, and Add Attachment actions.
- If the user confirms, continue automatically.
- If the user edits, update the report and continue from the confirmed version.
- If the user adds attachments, store them in InsForge Storage, append them to the evidence list, and re-render the same confirmation message.
- The confirmation message should say exactly what context was used, for example: "I used the `/reflex-bug-mode` command, 8 channel messages, and 2 attached files."

#### Intake Package

Purpose: Give the backend one complete, confirmed object before any fix work starts.

Responsibilities:

- Bundle the confirmed bug report, fetched chat history, attachment records, and storage URLs.
- Persist the full package in InsForge so diagnosis, Replicas, PR metadata, and demo replay all use the same source of truth.
- Preserve raw Slack message IDs and file IDs for traceability.
- Mark the package `confirmed` only after the user clicks Confirm.

Package contents:

```text
run_id
source_mode
confirmed_report
chat_history_messages
media_artifacts
debug_capture_artifacts
source_command
slack_channel_id
slack_update_thread_ts
context_window
confirmed_by
confirmed_at
```

#### Minimal Webhook/API Layer

Purpose: Normalize Slack input and orchestrate the Reflex pipeline.

Responsibilities:

- Serve `/api/slack/reflex-bug-mode`, `/api/slack/reflex-debug-mode`, `/api/slack/events`, `/api/slack/interactions`, `/api/runs`, `/api/runs/{runId}`, `/api/runs/{runId}/context`, `/api/runs/{runId}/debug-capture`, `/api/runs/{runId}/draft-bug-brief`, `/api/runs/{runId}/confirm-bug-brief`, `/api/runs/{runId}/intake-package`, `/api/runs/{runId}/diagnose`, `/api/runs/{runId}/dispatch-replicas`, `/api/runs/{runId}/events`, and `/api/replicas/callback`.
- Call InsForge SDK or REST APIs for database and storage state.
- Call the model path for diagnosis.
- Dispatch Replicas or the scripted fallback.
- Call GitHub or consume Replicas output for the final PR.

Hackathon discipline:

- This can be implemented with Next.js API routes, InsForge Edge Functions, or another small HTTP service.
- If Vercel is used, keep it focused on hosting this API and the tiny read-only dashboard.
- Long-running work should continue asynchronously after the Slack acknowledgement.

#### Tiny Demo Dashboard

Purpose: Provide a read-only inspection layer for judges and teammates. This dashboard should show
what Reflex stored and why the agent prompt is grounded in real evidence. It is not the primary user
workflow; Slack remains the main product surface.

Responsibilities:

- Render `/dashboard` as the first layer: all runs, current status, mode, role, repo, bug summary or symptom, diagnosis state, attachment count, PR link, and created time.
- Render `/dashboard/{runId}` as the second layer: confirmed bug report, copied Slack chat history, screenshots/videos/recordings, debug artifacts, diagnosis, hypotheses, selected hypothesis, run timeline, Replicas or scripted evidence, and PR verification.
- Read from InsForge only. The dashboard should not mutate runs, confirm reports, or dispatch agents.
- Use `run_events` for the timeline, not local UI state.
- Mirror the same stages already posted in Slack: created, context stored, report drafted, package confirmed, diagnosed, dispatched, reproduced, fixed, shipped.

Hackathon discipline:

- Keep the dashboard plain and data-dense.
- Build `/dashboard` and `/dashboard/{runId}` only after Slack intake, InsForge persistence, and the seeded bug path are working.
- Do not delay the core Slack-to-PR flow for a polished UI.

#### Observation API

Purpose: Persist the original source-of-truth report.

Responsibilities:

- Create a Reflex run.
- Store role, transcript, selected repo, screen snapshots, and timestamps.
- Normalize observations into a format suitable for diagnosis.
- Redact obvious secrets from transcripts and screenshots where practical.

#### Multimodal Symptom Extraction

Purpose: Convert screen frames and speech into structured observations.

Responsibilities:

- Extract visible UI state from screenshots.
- Combine screenshot observations with transcript text.
- Produce a concise symptom statement.
- Preserve uncertainty and missing evidence.

Implementation note:

The pasted concept mentions Gemini Live for screen and speech understanding. Gemini is not listed on the Luma event page as an event sponsor, so it should be treated as an optional model provider unless hackathon rules or sponsor guidance explicitly encourage its use. If sponsor alignment matters more, use InsForge model access or a sponsor-approved model path for the first version.

#### Diagnosis Service

Purpose: Convert the role-aware symptom into technical hypotheses.

Responsibilities:

- Apply the role lens.
- Load repo metadata and known issue memory.
- Produce a structured diagnosis object.
- Rank hypotheses by likelihood and ease of reproduction.
- Create agent briefs for sandbox execution.

Output contract:

```json
{
  "role": "sales_csm",
  "symptom": "Report export hangs on large datasets",
  "evidence": [
    "User described export hang",
    "Screen shows report export loading state"
  ],
  "hypotheses": [
    {
      "title": "Unbounded report query",
      "confidence": 0.72,
      "reproductionPlan": "Seed 10k records and run report export",
      "expectedFailure": "Request exceeds timeout or UI spinner remains active"
    }
  ]
}
```

#### Agent Orchestrator

Purpose: Dispatch hypotheses to coding agents and consolidate results.

Responsibilities:

- Start one sandbox task per top hypothesis.
- Pass each agent the repo, symptom, reproduction plan, and expected failure.
- Stream task status to Slack and the optional run page.
- Select the first hypothesis that produces reproducible evidence.
- Hand confirmed fixes to the implementation agent when appropriate.

#### Replicas Sandbox Agents

Purpose: Run the MVP coding-agent execution path in sandboxed development environments.

Responsibilities:

- Clone or access the seeded demo repo.
- Run setup commands.
- Execute the reproduction plan.
- Capture logs, screenshots, test failures, or timing evidence.
- Propose or implement a minimal fix.
- Open or update the GitHub PR when the fix is ready.

Parallel fan-out is valuable, but it is not required for the first working demo. The minimum Replicas integration is one structured task that reproduces the seeded bug, applies the fix, and produces PR evidence.

The key judging point is that confidence comes from sandbox reproduction, not from an LLM guess.

#### Devin Implementation Agent

Purpose: Optional second-agent path for implementing a confirmed fix or feature after reproduction succeeds.

Responsibilities:

- Receive confirmed root cause and evidence.
- Modify the codebase.
- Run tests.
- Prepare a PR with a clear summary and verification notes.

Hackathon fallback:

If Devin API access is unavailable or slow, keep Replicas as the primary executor and describe Devin as the second-agent path in the roadmap.

#### Limrun Mobile Extension

Purpose: Optional mobile reproduction path when a reported issue belongs to an iOS or Android app.

Responsibilities:

- Provide remote Xcode builds, iOS simulators, Android emulators, and browser-shareable mobile previews.
- Let cloud coding agents compile and test mobile changes without local device setup.
- Stream build logs and simulator status back to Reflex as reproduction evidence.

Hackathon fallback:

Do not include Limrun in the web-first MVP. Mention it as the natural extension for mobile bug reports.

#### InsForge Backend and Memory

Purpose: Provide backend primitives and persistent diagnostic memory.

Responsibilities:

- Store runs, observations, diagnoses, hypotheses, agent runs, and PR metadata in Postgres.
- Store `run_events` so Slack and the dashboard can show a complete timeline instead of only the latest status.
- Store screenshot, video, recording, log, and reproduction artifacts in Storage.
- Publish pipeline status changes through Realtime, or support simple polling from the UI.
- Provide optional auth if the demo needs user identity.
- Provide optional model gateway access for diagnosis generation.
- Maintain the symptom-resolution memory graph as a future product feature.

Implementation setup:

```bash
npx @insforge/cli login
npx @insforge/cli link
npx @insforge/cli current
npm install @insforge/sdk
```

Memory graph concept:

- Symptom: "export hangs on large datasets"
- Resolved location: `src/reports/export.ts`
- Cause: "unbounded query without pagination"
- Fix type: "add pagination and streaming response"
- Evidence: "large dataset export test passes"

## 7. Data Model

### 7.1 `reflex_runs`

| Field | Type | Description |
| --- | --- | --- |
| `id` | UUID | Run identifier |
| `run_key` | Text | Human-readable run key, such as `run_export_hang_01` |
| `source` | Text | `web`, `slack`, or `manual` |
| `mode` | Text | `bug` for Slack context intake or `debug` for live reproduction capture |
| `role` | Text | Defaulted or user-selected role, `sales_csm` for the happy path |
| `repo_url` | Text | Target repository |
| `command_text` | Text | Optional text passed to `/reflex-bug-mode` or `/reflex-debug-mode` |
| `slack_channel_id` | Text | Slack channel where the run started |
| `slack_thread_ts` | Text | Slack update thread timestamp, or source thread timestamp when using the optional message shortcut |
| `context_window` | JSON | Limits used for Slack message candidates, attachments, debug artifacts, and prompt chars |
| `status` | Text | Current pipeline state |
| `created_at` | Timestamp | Run start time |
| `completed_at` | Timestamp | Run completion time |

### 7.2 `run_events`

| Field | Type | Description |
| --- | --- | --- |
| `id` | UUID | Event identifier |
| `run_id` | UUID | Parent Reflex run |
| `event_type` | Text | Stable event name, such as `report.drafted`, `diagnosis.created`, or `pr.opened` |
| `status` | Text | Pipeline status after the event, if the event changes state |
| `title` | Text | Short dashboard/Slack display title |
| `detail` | Text | Human-readable event detail |
| `payload` | JSON | Optional structured data, such as counts, PR URL, or evidence references |
| `actor` | Text | Slack user ID, service name, or agent provider that caused the event |
| `created_at` | Timestamp | Event time |

### 7.3 `slack_context_messages`

| Field | Type | Description |
| --- | --- | --- |
| `id` | UUID | Context message identifier |
| `run_id` | UUID | Parent Reflex run |
| `slack_message_ts` | Text | Slack message timestamp |
| `slack_user_id` | Text | Slack user ID, if available |
| `text` | Text | Message text copied from Slack |
| `permalink` | Text | Slack permalink, if available |
| `has_files` | Boolean | Whether the message contains files |
| `raw_payload` | JSON | Minimal raw Slack message payload for traceability |
| `created_at` | Timestamp | Copy time |

### 7.4 `observations`

| Field | Type | Description |
| --- | --- | --- |
| `id` | UUID | Observation identifier |
| `run_id` | UUID | Parent Reflex run |
| `transcript` | Text | Slack transcript, debug audio transcript, or optional user text |
| `screenshot_url` | Text | Stored screen snapshot |
| `visible_state` | JSON | Extracted UI state |
| `created_at` | Timestamp | Observation time |

### 7.5 `media_artifacts`

| Field | Type | Description |
| --- | --- | --- |
| `id` | UUID | Media artifact identifier |
| `run_id` | UUID | Parent Reflex run |
| `artifact_key` | Text | Human-readable key, such as `media_run_export_hang_01_screenshot_1` |
| `kind` | Text | `screenshot`, `video`, `screen_recording`, `audio_recording`, `transcript`, `log`, or `other` |
| `source` | Text | `slack_file`, `debug_capture`, `manual_upload`, `replicas`, or `manual` |
| `storage_url` | Text | InsForge Storage URL or object reference |
| `slack_file_id` | Text | Original Slack file ID if applicable |
| `slack_message_ts` | Text | Slack message timestamp where the file appeared, if applicable |
| `thumbnail_url` | Text | Optional preview image for Slack/status UI |
| `summary` | Text | Compact human/model-readable summary |
| `safe_to_share` | Boolean | Whether this artifact can be linked from PR/debug output |
| `created_at` | Timestamp | Artifact creation time |

### 7.6 `bug_briefs`

| Field | Type | Description |
| --- | --- | --- |
| `id` | UUID | Bug brief identifier |
| `run_id` | UUID | Parent Reflex run |
| `brief_key` | Text | Human-readable brief key, such as `brief_run_export_hang_01` |
| `where_it_happens` | Text | Product area, page, workflow, or surface where the bug appears |
| `actual_behavior` | Text | What the user says or sees happening |
| `expected_behavior` | Text | What should happen instead |
| `reproduction_context` | Text | Known repro steps, data shape, user segment, or environment |
| `affected_surface` | Text | `frontend`, `backend`, `mobile`, `infra`, or `unknown` |
| `evidence_summary` | JSON | Compact references to screenshots, videos, recordings, and logs |
| `missing_info` | JSON | Questions or placeholders that still need confirmation |
| `agent_prompt_preview` | Text | Compact prompt that will be sent to diagnosis/Replicas after confirmation |
| `status` | Text | Draft, needs_confirmation, confirmed, or rejected |
| `created_at` | Timestamp | Brief creation time |
| `confirmed_at` | Timestamp | Confirmation time |

### 7.7 `intake_packages`

| Field | Type | Description |
| --- | --- | --- |
| `id` | UUID | Intake package identifier |
| `run_id` | UUID | Parent Reflex run |
| `bug_brief_id` | UUID | Confirmed report used for the package |
| `package_key` | Text | Human-readable key, such as `pkg_run_export_hang_01` |
| `chat_history` | JSON | Ordered copied Slack messages used for diagnosis |
| `media_artifacts` | JSON | Ordered attachment and storage references |
| `debug_capture_artifacts` | JSON | Ordered debug recording, audio, screenshot, transcript, and note references |
| `confirmed_report` | JSON | Confirmed bug report fields shown to the user |
| `status` | Text | Draft, confirmed, or superseded |
| `confirmed_by` | Text | Slack user ID that confirmed the package |
| `created_at` | Timestamp | Package creation time |
| `confirmed_at` | Timestamp | Confirmation time |

### 7.8 `diagnoses`

| Field | Type | Description |
| --- | --- | --- |
| `id` | UUID | Diagnosis identifier |
| `run_id` | UUID | Parent Reflex run |
| `bug_brief_id` | UUID | Confirmed report record used for diagnosis |
| `intake_package_id` | UUID | Confirmed report, chat history, and attachments used for diagnosis |
| `symptom` | Text | Structured engineering symptom |
| `role_lens` | Text | Role-specific translation strategy |
| `evidence` | JSON | Evidence extracted from screen and transcript |
| `created_at` | Timestamp | Diagnosis time |

### 7.9 `hypotheses`

| Field | Type | Description |
| --- | --- | --- |
| `id` | UUID | Hypothesis identifier |
| `diagnosis_id` | UUID | Parent diagnosis |
| `title` | Text | Short hypothesis name |
| `confidence` | Float | Ranked likelihood |
| `reproduction_plan` | Text | Sandbox instructions |
| `expected_failure` | Text | Failure the sandbox should prove before fixing |
| `status` | Text | Pending, running, reproduced, rejected, fixed |

### 7.10 `agent_runs`

| Field | Type | Description |
| --- | --- | --- |
| `id` | UUID | Agent run identifier |
| `hypothesis_id` | UUID | Hypothesis being tested |
| `provider` | Text | Replicas, Devin, or fallback |
| `status` | Text | Pending, running, reproduced, fixed, shipped, or failed |
| `sandbox_url` | Text | Sandbox reference |
| `logs_url` | Text | Execution logs |
| `result` | JSON | Reproduction and fix result |
| `created_at` | Timestamp | Run start time |
| `completed_at` | Timestamp | Run completion time |

### 7.11 `pull_requests`

| Field | Type | Description |
| --- | --- | --- |
| `id` | UUID | Internal PR record |
| `run_id` | UUID | Source Reflex run |
| `agent_run_id` | UUID | Producing run |
| `github_url` | Text | Pull request URL |
| `root_cause` | Text | Root cause found during reproduction |
| `summary` | Text | Fix summary |
| `verification` | Text | Tests or reproduction evidence |
| `created_at` | Timestamp | PR creation time |

### 7.12 MVP Migration Shape

The MVP can start with straightforward Postgres tables and JSON payload columns. Keep the schema explicit enough for the UI and demo, then normalize later only if the product grows.

```sql
create table reflex_runs (
  id uuid primary key default gen_random_uuid(),
  run_key text not null unique,
  source text not null default 'slack',
  mode text not null default 'bug',
  role text not null default 'sales_csm',
  repo_url text not null,
  command_text text not null default '',
  slack_channel_id text,
  slack_thread_ts text,
  context_window jsonb not null default '{"messageLimit":100,"attachments":3,"maxPromptChars":6000}'::jsonb,
  status text not null default 'created',
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table run_events (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references reflex_runs(id) on delete cascade,
  event_type text not null,
  status text,
  title text not null default '',
  detail text not null default '',
  payload jsonb not null default '{}'::jsonb,
  actor text,
  created_at timestamptz not null default now()
);

create table slack_context_messages (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references reflex_runs(id) on delete cascade,
  slack_message_ts text not null,
  slack_user_id text,
  text text not null default '',
  permalink text,
  has_files boolean not null default false,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table observations (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references reflex_runs(id) on delete cascade,
  transcript text not null,
  screenshot_url text,
  visible_state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table media_artifacts (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references reflex_runs(id) on delete cascade,
  artifact_key text not null unique,
  kind text not null,
  source text not null default 'slack_file',
  storage_url text not null,
  slack_file_id text,
  slack_message_ts text,
  thumbnail_url text,
  summary text,
  safe_to_share boolean not null default false,
  created_at timestamptz not null default now()
);

create table bug_briefs (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references reflex_runs(id) on delete cascade,
  brief_key text not null unique,
  where_it_happens text not null,
  actual_behavior text not null,
  expected_behavior text,
  reproduction_context text,
  affected_surface text not null default 'unknown',
  evidence_summary jsonb not null default '[]'::jsonb,
  missing_info jsonb not null default '[]'::jsonb,
  agent_prompt_preview text not null,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);

create table intake_packages (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references reflex_runs(id) on delete cascade,
  bug_brief_id uuid not null references bug_briefs(id) on delete cascade,
  package_key text not null unique,
  chat_history jsonb not null default '[]'::jsonb,
  media_artifacts jsonb not null default '[]'::jsonb,
  debug_capture_artifacts jsonb not null default '[]'::jsonb,
  confirmed_report jsonb not null default '{}'::jsonb,
  status text not null default 'draft',
  confirmed_by text,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);

create table diagnoses (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references reflex_runs(id) on delete cascade,
  bug_brief_id uuid not null references bug_briefs(id) on delete cascade,
  intake_package_id uuid not null references intake_packages(id) on delete cascade,
  symptom text not null,
  role_lens text not null,
  evidence jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table hypotheses (
  id uuid primary key default gen_random_uuid(),
  diagnosis_id uuid not null references diagnoses(id) on delete cascade,
  title text not null,
  confidence numeric not null default 0,
  reproduction_plan text not null,
  expected_failure text not null default '',
  status text not null default 'pending'
);

create table agent_runs (
  id uuid primary key default gen_random_uuid(),
  hypothesis_id uuid references hypotheses(id) on delete set null,
  provider text not null,
  status text not null default 'pending',
  sandbox_url text,
  logs_url text,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table pull_requests (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references reflex_runs(id) on delete cascade,
  agent_run_id uuid references agent_runs(id) on delete set null,
  github_url text not null,
  root_cause text not null default '',
  summary text not null,
  verification text not null,
  created_at timestamptz not null default now()
);
```

## 8. API Surface

### Naming Rules

Use `run` for the whole Reflex pipeline and `task` for external execution work. Avoid mixing `session`, `job`, and `task` for the same concept. In route paths, `{runId}` should use the human-readable `run_key` value, not the raw database UUID.

| Concept | Name Pattern | Example |
| --- | --- | --- |
| Reflex run | `run_{shortId}` | `run_export_hang_01` |
| Bug brief | `brief_{runId}` | `brief_run_export_hang_01` |
| Intake package | `pkg_{runId}` | `pkg_run_export_hang_01` |
| Media artifact | `media_{runId}_{kind}_{index}` | `media_run_export_hang_01_screenshot_1` |
| Diagnosis | `diag_{shortId}` | `diag_export_hang_01` |
| Hypothesis | `hyp_{rank}_{slug}` | `hyp_1_unbounded_export_query` |
| Internal agent run | `agent_run_{shortId}` | `agent_run_export_hang_01` |
| Replicas task | `replicas_{runId}_{slug}` | `replicas_run_export_hang_01_reproduce_export_hang` |
| Slack thread update | `slack_update_{stage}` | `slack_update_reproduced` |
| GitHub branch | `reflex/{runId}/{slug}` | `reflex/run_export_hang_01/fix-export-hang` |

Status values:

```text
created -> context_stored -> clarifying -> report_drafted -> package_confirmed -> diagnosed -> dispatched -> reproduced -> fixed -> shipped
```

Failure values:

```text
clarification_failed
diagnosis_failed
dispatch_failed
reproduction_failed
pr_failed
```

### `POST /api/slack/reflex-bug-mode`

Primary MVP intake. Receives the `/reflex-bug-mode` Slack slash command, creates a run, acknowledges Slack quickly, and continues the pipeline asynchronously.

Example command:

```text
/reflex-bug-mode
```

Optional command text is allowed when the user wants to override the nearby Slack context:

```text
/reflex-bug-mode export hangs when customer downloads a large report
```

Response:

```json
{
  "runId": "run_export_hang_01",
  "status": "created",
  "message": "Bug mode started. I used nearby Slack context and will ask for confirmation before dispatching an agent."
}
```

### `POST /api/slack/reflex-debug-mode`

Second MVP entry point. Receives the `/reflex-debug-mode` Slack slash command, creates a debug-mode run, and returns a link to the browser recorder. This path is for a user actively reproducing a bug instead of reporting an issue that already exists in Slack history.

Example command:

```text
/reflex-debug-mode
```

Response:

```json
{
  "runId": "run_export_hang_01",
  "status": "created",
  "message": "Debug mode started. Open the recorder, reproduce the issue, then click Done.",
  "recordingUrl": "https://reflex.example.com/debug/run_export_hang_01"
}
```

### `POST /api/slack/events`

Optional Slack Events API endpoint for attachments, threaded replies, and message events. Use it when the screenshot or recording arrives as a Slack file instead of inline command text.

### `POST /api/slack/interactions`

Receives Slack button clicks or modal submissions from the bug report confirmation message.

Actions:

- `confirm_bug_brief`: confirm the drafted report and continue to intake package creation.
- `edit_bug_brief`: submit corrected report fields, then confirm and continue.
- `add_attachment`: let the user add more screenshot, video, or recording evidence before confirmation.

Request shape after normalization:

```json
{
  "runId": "run_export_hang_01",
  "action": "confirm_bug_brief",
  "bugBriefId": "brief_run_export_hang_01",
  "editedFields": null,
  "additionalMediaArtifactIds": []
}
```

### `POST /api/runs`

Internal normalized run creation. Slack, a future web form, or a seeded demo script should all map into this shape.

Request:

```json
{
  "source": "slack",
  "mode": "bug",
  "role": "sales_csm",
  "repoUrl": "https://github.com/yxshrk/electron",
  "transcript": "Customer says export hangs on large reports.",
  "commandText": "",
  "screenshotUrl": "https://...",
  "slackChannelId": "C123",
  "slackThreadTs": null,
  "contextWindow": {
    "messageLimit": 100,
    "attachments": 3,
    "maxPromptChars": 6000
  }
}
```

Response:

```json
{
  "runId": "run_export_hang_01",
  "status": "created"
}
```

### `GET /api/runs`

Read-only list endpoint for `/dashboard`. It should be fast, shallow, and good enough for judges to
see every active or demo-seeded Reflex run.

Response:

```json
{
  "runs": [
    {
      "runId": "run_export_hang_01",
      "mode": "bug",
      "role": "sales_csm",
      "repoUrl": "https://github.com/yxshrk/electron",
      "status": "diagnosed",
      "summary": "Report export hangs on large datasets",
      "diagnosisId": "diag_export_hang_01",
      "mediaArtifactCount": 2,
      "prUrl": null,
      "createdAt": "2026-06-06T18:00:00Z"
    }
  ]
}
```

### `GET /api/runs/{runId}`

Read-only detail endpoint for `/dashboard/{runId}`. It should return the complete demo evidence
bundle so the dashboard can render without making many small requests.

Response:

```json
{
  "run": {
    "runId": "run_export_hang_01",
    "status": "shipped",
    "mode": "bug",
    "role": "sales_csm",
    "repoUrl": "https://github.com/yxshrk/electron"
  },
  "timeline": [
    {
      "eventType": "report.drafted",
      "status": "report_drafted",
      "title": "Bug report drafted",
      "detail": "Used 8 Slack messages and 2 files."
    }
  ],
  "chatHistory": [],
  "mediaArtifacts": [],
  "confirmedReport": {},
  "diagnosis": {},
  "hypotheses": [],
  "agentRuns": [],
  "pullRequest": {
    "url": "https://github.com/yxshrk/electron/pull/42"
  }
}
```

### `POST /api/runs/{runId}/context`

Stores the Slack context that Reflex automatically fetched before drafting the report. This is the backend copy of the chat history and attachment references, not just prompt text.

Request:

```json
{
  "messages": [
    {
      "slackMessageTs": "1710000000.000100",
      "slackUserId": "U123",
      "text": "Customer says export hangs on large reports.",
      "permalink": "https://example.slack.com/archives/C123/p1710000000000100",
      "hasFiles": true
    }
  ],
  "attachments": [
    {
      "slackFileId": "F123",
      "slackMessageTs": "1710000000.000100",
      "kind": "video",
      "filename": "export-crash.mov"
    }
  ]
}
```

Response:

```json
{
  "storedMessages": 8,
  "storedAttachments": 2,
  "status": "stored"
}
```

### `POST /api/runs/{runId}/debug-capture`

Stores live debug-mode artifacts after the user clicks Done in the recorder. These artifacts enter the same evidence list as Slack attachments and are included in the confirmed intake package.

Request:

```json
{
  "recordingUrl": "insforge://reflex-evidence/run_export_hang_01/debug-recording.webm",
  "audioUrl": "insforge://reflex-evidence/run_export_hang_01/debug-audio.webm",
  "transcript": "I clicked Export, the spinner stayed visible, then the frontend crashed.",
  "screenshots": [
    "insforge://reflex-evidence/run_export_hang_01/debug-frame-1.png"
  ],
  "notes": "Reproduced in Chrome on a large customer report."
}
```

Response:

```json
{
  "storedArtifacts": 3,
  "status": "stored"
}
```

### `POST /api/runs/{runId}/draft-bug-brief`

Reads the Slack command text, nearby Slack history, and attachment references, then drafts a compact bug report for user confirmation. This route exists to avoid wasting model and agent tokens on the wrong interpretation of the bug.

Request:

```json
{
  "includeSlackHistory": true,
  "messageLimit": 100,
  "includeAttachments": true,
  "attachmentLimit": 3,
  "includeDebugCapture": true,
  "maxPromptChars": 6000
}
```

Response:

```json
{
  "bugBriefId": "brief_run_export_hang_01",
  "status": "needs_confirmation",
  "whereItHappens": "Report export screen",
  "actualBehavior": "When the user exports a large report, the frontend hangs or crashes.",
  "expectedBehavior": "The report export should complete or show progress without crashing.",
  "reproductionContext": "Large customer report export from the reporting page.",
  "affectedSurface": "frontend",
  "evidenceSummary": [
    {
      "kind": "video",
      "mediaArtifactId": "media_run_export_hang_01_video_1",
      "summary": "Screen recording shows export clicked, spinner shown, then frontend crash."
    },
    {
      "kind": "screenshot",
      "mediaArtifactId": "media_run_export_hang_01_screenshot_1",
      "summary": "Screenshot shows the report export screen stuck in loading state."
    }
  ],
  "missingInfo": [
    "Exact browser is unknown",
    "Dataset size is approximate"
  ],
  "agentPromptPreview": "Investigate the report export flow. The user reports that exporting a large report from the frontend hangs or crashes. Confirm whether the frontend export handler blocks, crashes, or waits on an unbounded backend response before changing code."
}
```

Slack confirmation message:

```text
Reflex understood the bug this way:

Context used: /reflex-bug-mode command, 8 channel messages, 2 attached files.

Where: Report export screen
Actual: Exporting a large report hangs or crashes the frontend.
Expected: Export should complete or show progress.
Surface: frontend
Evidence: video shows export click -> spinner -> frontend crash; screenshot shows stuck loading state.

[Confirm] [Edit Report] [Add Attachment]
```

### `POST /api/runs/{runId}/confirm-bug-brief`

Confirms the bug report, optionally with edited fields or additional attachments from Slack. Diagnosis must only run after the confirmed intake package exists.

Request:

```json
{
  "bugBriefId": "brief_run_export_hang_01",
  "editedFields": {
    "actualBehavior": "When export starts, the frontend crashes instead of just hanging."
  },
  "additionalMediaArtifactIds": [
    "media_run_export_hang_01_screenshot_2"
  ],
  "confirmedBy": "U123"
}
```

Response:

```json
{
  "bugBriefId": "brief_run_export_hang_01",
  "intakePackageId": "pkg_run_export_hang_01",
  "status": "confirmed"
}
```

### `POST /api/runs/{runId}/intake-package`

Creates or returns the confirmed backend package that diagnosis and Replicas must use. The package includes the final report, copied chat history, media artifact records, and Slack source metadata.

Request:

```json
{
  "bugBriefId": "brief_run_export_hang_01",
  "includeChatHistory": true,
  "includeMediaArtifacts": true
}
```

Response:

```json
{
  "intakePackageId": "pkg_run_export_hang_01",
  "status": "confirmed",
  "confirmedReport": {
    "whereItHappens": "Report export screen",
    "actualBehavior": "When export starts, the frontend crashes.",
    "expectedBehavior": "Export should complete or show progress.",
    "affectedSurface": "frontend"
  },
  "chatHistoryMessageCount": 8,
  "mediaArtifactCount": 3
}
```

### `POST /api/runs/{runId}/observations`

Stores additional observations after the run exists. For the MVP, this is mostly for Slack file attachments that arrive after the slash command.

Request:

```json
{
  "transcript": "Every time I pull the big export it just hangs.",
  "screenshotUrl": "https://...",
  "recordingUrl": null,
  "source": "slack_file"
}
```

Response:

```json
{
  "observationId": "obs_123",
  "status": "stored"
}
```

### `POST /api/runs/{runId}/media`

Stores screenshot, video, screen recording, log, or reproduction evidence metadata after the file is uploaded to InsForge Storage. Slack files should be copied into InsForge Storage first so Reflex has a durable reference independent of Slack retention.

Request:

```json
{
  "kind": "video",
  "source": "slack_file",
  "storageUrl": "insforge://reflex-evidence/run_export_hang_01/export-crash.mov",
  "slackFileId": "F123",
  "thumbnailUrl": "insforge://reflex-evidence/run_export_hang_01/export-crash-thumb.png",
  "summary": "Screen recording shows the export button clicked, a loading spinner for several seconds, then the frontend crashes.",
  "safeToShare": false
}
```

Response:

```json
{
  "mediaArtifactId": "media_run_export_hang_01_video_1",
  "status": "stored"
}
```

### `POST /api/runs/{runId}/diagnose`

Generates a structured symptom and hypothesis tree from the confirmed intake package. This route should reject runs that do not have a confirmed bug report package.

Request:

```json
{
  "intakePackageId": "pkg_run_export_hang_01"
}
```

Response:

```json
{
  "diagnosisId": "diag_export_hang_01",
  "bugBriefId": "brief_run_export_hang_01",
  "intakePackageId": "pkg_run_export_hang_01",
  "symptom": "Report export hangs on large datasets",
  "hypotheses": [
    {
      "id": "hyp_1_unbounded_export_query",
      "title": "Unbounded report query",
      "confidence": 0.72
    }
  ]
}
```

### `POST /api/runs/{runId}/dispatch-replicas`

Dispatches the top hypothesis to Replicas. The route name is explicit because the MVP execution provider is Replicas; future providers can get their own dispatch routes.

Replicas task naming:

```text
Task name: replicas_{runId}_{action_slug}
Task title: [Reflex] {symptom} - {hypothesis_title}
```

Example:

```text
Task name: replicas_run_export_hang_01_reproduce_export_hang
Task title: [Reflex] Report export hangs on large datasets - Unbounded report query
```

Request:

```json
{
  "hypothesisId": "hyp_1_unbounded_export_query",
  "taskName": "replicas_run_export_hang_01_reproduce_export_hang",
  "taskTitle": "[Reflex] Report export hangs on large datasets - Unbounded report query"
}
```

Response:

```json
{
  "agentRunId": "agent_run_export_hang_01",
  "replicasTaskName": "replicas_run_export_hang_01_reproduce_export_hang",
  "replicasTaskTitle": "[Reflex] Report export hangs on large datasets - Unbounded report query",
  "status": "running"
}
```

### `POST /api/replicas/callback`

Receives Replicas task updates, stores evidence in InsForge, and posts the matching Slack thread update.

Request:

```json
{
  "runId": "run_export_hang_01",
  "agentRunId": "agent_run_export_hang_01",
  "replicasTaskName": "replicas_run_export_hang_01_reproduce_export_hang",
  "status": "reproduced",
  "rootCause": "Report export loads all rows synchronously.",
  "verification": "Large export fixture reproduces the timeout.",
  "logsUrl": "https://..."
}
```

### `GET /api/runs/{runId}/events`

Read-only endpoint for Slack thread updates and the dashboard timeline. It can stream pipeline
events over Server-Sent Events, or return stored `run_events` rows for polling.

Event examples:

```json
{ "eventType": "diagnosis.created", "status": "diagnosed", "detail": "Report export hangs on large datasets" }
{ "eventType": "agent.reproduced", "status": "reproduced", "detail": "Export test timed out at 30s" }
{ "eventType": "pr.opened", "status": "shipped", "url": "https://github.com/yxshrk/electron/pull/42" }
```

### Prompt Templates

Prompt templates are part of the technical contract. Keep them deterministic, short, and grounded in
the confirmed data stored in InsForge. The implementation should keep these templates in code as
versioned constants, for example `lib/diagnosis/prompts.ts` and `agent/replicas/prompt.ts`.

Shared prompt rules:

- Do not invent evidence. If a field is unknown, use `missingInfo`.
- Prefer copied Slack message IDs, media artifact IDs, and storage URLs over prose-only references.
- Keep the prompt context under `contextWindow.maxPromptChars`, default 6000 characters.
- Use the latest 100 Slack messages as candidates, then select/summarize the relevant subset once.
- Return valid JSON for model-generated backend objects.
- Keep user-facing language concise enough to fit inside one Slack confirmation message.
- Do not dispatch Replicas until the bug report has been confirmed and an `intake_packages` row exists.

#### Bug Report Draft Prompt

Used by `POST /api/runs/{runId}/draft-bug-brief`.

System prompt:

```text
You are Reflex, a bug-intake assistant for engineering teams.

Your job is to convert messy Slack/debug context into a compact bug report that a human can confirm.
Do not diagnose root cause yet. Do not propose code changes yet. Do not invent facts.

If important details are missing, put them in missingInfo instead of guessing.
Return only JSON that matches the requested schema.
```

User prompt template:

```text
Create a confirmable bug report from this Reflex run.

Run:
- runId: {{runId}}
- sourceMode: {{mode}}
- role: {{role}}
- repoUrl: {{repoUrl}}
- commandText: {{commandText}}

Slack context candidates:
{{slackMessages}}

Media artifacts:
{{mediaArtifacts}}

Debug capture artifacts:
{{debugArtifacts}}

Output JSON schema:
{
  "whereItHappens": "Product area, page, workflow, or unknown",
  "actualBehavior": "What the user sees happening",
  "expectedBehavior": "What should happen instead, or null",
  "reproductionContext": "Known steps, data shape, browser, customer segment, or null",
  "affectedSurface": "frontend | backend | mobile | infra | unknown",
  "evidenceSummary": [
    {
      "kind": "slack_message | screenshot | video | screen_recording | audio_recording | transcript | log | other",
      "sourceId": "Slack ts, Slack file id, or mediaArtifactId",
      "summary": "Short evidence summary"
    }
  ],
  "missingInfo": ["Short missing detail or question"],
  "agentPromptPreview": "One compact paragraph preview of what will be sent to diagnosis/agent after confirmation"
}
```

Demo fixture output shape:

```json
{
  "whereItHappens": "Report export screen",
  "actualBehavior": "When the user exports a large report, the frontend hangs or crashes.",
  "expectedBehavior": "The report export should complete or show progress without crashing.",
  "reproductionContext": "Large customer report export from the reporting page.",
  "affectedSurface": "frontend",
  "evidenceSummary": [
    {
      "kind": "video",
      "sourceId": "media_run_export_hang_01_video_1",
      "summary": "Screen recording shows export clicked, spinner shown, then frontend crash."
    }
  ],
  "missingInfo": [
    "Exact browser is unknown",
    "Dataset size is approximate"
  ],
  "agentPromptPreview": "Investigate the report export flow. The user reports that exporting a large report from the frontend hangs or crashes. Confirm whether the frontend export handler blocks, crashes, or waits on an unbounded backend response before changing code."
}
```

#### Diagnosis Prompt

Used by `POST /api/runs/{runId}/diagnose` after confirmation.

System prompt:

```text
You are Reflex, a role-aware debugging planner.

Your job is to translate a confirmed bug report and evidence package into an engineering symptom and
ranked reproduction hypotheses. You must stay grounded in the confirmed report, copied chat history,
and artifact summaries. Do not write code. Do not claim a root cause is proven until an agent
reproduces it.

Return only JSON that matches the requested schema.
```

User prompt template:

```text
Diagnose this confirmed Reflex intake package.

Run:
- runId: {{runId}}
- role: {{role}}
- repoUrl: {{repoUrl}}

Confirmed report:
{{confirmedReport}}

Relevant chat history:
{{chatHistory}}

Evidence artifacts:
{{mediaArtifacts}}

Debug artifacts:
{{debugArtifacts}}

Role lens:
{{roleLensInstruction}}

Output JSON schema:
{
  "symptom": "One concise engineering symptom",
  "roleLens": "How the role changed interpretation",
  "evidence": [
    {
      "sourceId": "message id, mediaArtifactId, or debug artifact id",
      "summary": "Short evidence summary"
    }
  ],
  "hypotheses": [
    {
      "title": "Short hypothesis",
      "confidence": 0.0,
      "reproductionPlan": "Concrete sandbox reproduction steps",
      "expectedFailure": "What should fail before the fix"
    }
  ]
}
```

Role lens instructions:

```text
sales_csm: Translate customer-facing language into a reproducible engineering symptom. Preserve customer impact.
ceo: Broaden the symptom into measurable business/product bottlenecks before narrowing to engineering causes.
product: Treat the input as a workflow or expected-behavior gap and produce implementation-oriented hypotheses.
engineer: Preserve technical specificity and skip business translation.
```

Demo fixture output shape:

```json
{
  "symptom": "Report export hangs on large datasets",
  "roleLens": "Translated sales/CSM customer language into a reproducible frontend/backend export failure.",
  "evidence": [
    {
      "sourceId": "brief_run_export_hang_01",
      "summary": "Confirmed report says large report export hangs or crashes."
    },
    {
      "sourceId": "media_run_export_hang_01_video_1",
      "summary": "Video shows export click followed by spinner and crash."
    }
  ],
  "hypotheses": [
    {
      "title": "Unbounded report query",
      "confidence": 0.72,
      "reproductionPlan": "Seed a large dataset and trigger report export from the reporting page.",
      "expectedFailure": "Export request exceeds timeout or the frontend spinner never resolves."
    }
  ]
}
```

#### Replicas Agent Prompt

Used by `POST /api/runs/{runId}/dispatch-replicas` or the scripted fallback after diagnosis.

Prompt template:

```text
You are a coding agent working in a sandboxed development environment.

Goal:
Reproduce the confirmed bug, identify the smallest credible fix, verify it, and open a PR.

Hard rules:
- First reproduce the bug before changing code.
- Do not broaden scope beyond the selected hypothesis.
- Prefer a minimal patch over a refactor.
- Record the failing command/output before the fix and the passing command/output after the fix.
- Include evidence in the PR body.

Run:
- runId: {{runId}}
- intakePackageId: {{intakePackageId}}
- repoUrl: {{repoUrl}}
- role: {{role}}

Confirmed bug report:
{{confirmedReport}}

Engineering symptom:
{{symptom}}

Selected hypothesis:
- hypothesisId: {{hypothesisId}}
- title: {{hypothesisTitle}}
- reproductionPlan: {{reproductionPlan}}
- expectedFailure: {{expectedFailure}}

Evidence references:
{{evidenceReferences}}

Required output:
1. Reproduction result with command and failing output.
2. Root cause summary.
3. Minimal fix.
4. Verification result with command and passing output.
5. GitHub PR URL.
```

Demo fixture prompt values:

```text
runId: run_export_hang_01
intakePackageId: pkg_run_export_hang_01
repoUrl: https://github.com/yxshrk/electron
role: sales_csm
symptom: Report export hangs on large datasets
hypothesisId: hyp_1_unbounded_export_query
hypothesisTitle: Unbounded report query
reproductionPlan: Seed a large dataset and trigger report export from the reporting page.
expectedFailure: Export request times out or spinner never resolves.
```

#### PR Body Template

Used by Replicas or the scripted fallback when opening the GitHub PR.

```markdown
## Reflex Fix

Source run: {{runId}}
Intake package: {{intakePackageId}}
Role: {{role}}
Symptom: {{symptom}}

## Confirmed Report

- Where: {{whereItHappens}}
- Actual: {{actualBehavior}}
- Expected: {{expectedBehavior}}
- Surface: {{affectedSurface}}

## Evidence Used

{{evidenceBullets}}

## Reproduction

Before fix:
`{{failingCommand}}`

Result:
{{failingOutputSummary}}

## Root Cause

{{rootCause}}

## Fix

{{fixSummary}}

## Verification

After fix:
`{{passingCommand}}`

Result:
{{passingOutputSummary}}
```

## 9. End-to-End Flow

### Path A: Bug Mode From Existing Slack Context

1. CSM runs `/reflex-bug-mode` in the Slack channel right after the customer issue appears.
2. Reflex immediately creates a `bug` run with default role `sales_csm` and default repo `https://github.com/yxshrk/electron`.
3. Slack sends the command to `/api/slack/reflex-bug-mode`.
4. The API normalizes the command into `POST /api/runs`.
5. Reflex fetches the latest 100 channel messages and latest 3 nearby attachments, then stores them through `POST /api/runs/{runId}/context`.
6. Slack file attachments are copied to InsForge Storage and registered through `POST /api/runs/{runId}/media`.

### Path B: Debug Mode From Live Reproduction

1. User runs `/reflex-debug-mode` when they need to reproduce the issue live.
2. Reflex creates a `debug` run and returns an Open Recorder link.
3. User records screen and audio, optionally adds notes or screenshots, then clicks Done.
4. The recorder uploads artifacts through `POST /api/runs/{runId}/debug-capture`.
5. Reflex stores the recording, transcript, screenshots, notes, and optional Slack context as run evidence.

### Shared Tail

1. `POST /api/runs/{runId}/draft-bug-brief` drafts one compact bug report from Slack context, debug capture artifacts, and media summaries.
2. Slack asks the user to Confirm, Edit Report, or Add Attachment, and clearly shows the context used.
3. If the report is wrong, the user edits fields manually or uploads more attachments into the bot update thread.
4. User confirms the report through `POST /api/slack/interactions`.
5. `POST /api/runs/{runId}/intake-package` stores the confirmed report, copied chat history, debug artifacts, and attachments as the backend source of truth.
6. Diagnosis service creates the symptom from the confirmed package: "Report export hangs on large datasets."
7. Diagnosis service ranks hypotheses: unbounded query, missing pagination, or request timeout mismatch.
8. Orchestrator dispatches one Replicas task for the top hypothesis.
9. Replicas seeds a large dataset, reproduces the hang, writes a minimal fix, and runs verification.
10. GitHub PR opens with reproduction evidence and a link to the source run.
11. The Reflex bot update thread receives the PR URL and final verification summary.
12. `/dashboard` shows the run in the list, and `/dashboard/{runId}` shows the chat history, attachments, diagnosis, timeline, evidence, and PR.

The simplest user-facing flow is:

```text
/reflex-bug-mode
-> Confirm or edit generated bug report
-> Backend receives report + chat history + attachments
-> Watch Replicas produce a PR

/reflex-debug-mode
-> Record reproduction and click Done
-> Confirm or edit generated bug report
-> Backend receives report + recording + transcript + screenshots
-> Watch Replicas produce a PR
```

## 10. Demo Repository Requirements

The demo repository must contain at least one seeded issue that maps cleanly from a vague user
symptom to a reproducible technical failure. Two or three seeded issues are useful for backup, but
the primary export-hang bug is required for a reliable end-to-end demo.

Required primary bug:

- Surface symptom: report export spinner hangs.
- Root cause: unbounded database query or synchronous processing path.
- Reproduction: seed large dataset and trigger export.
- Fix: add pagination, streaming, batching, or query bound.
- Verification: export completes under defined timeout and test passes.

Required setup artifacts:

- A failing test, script, or documented command that reproduces the export hang before the fix.
- A seeded data fixture large enough to make the failure deterministic.
- A known minimal patch for the scripted fallback path.
- A PR body template that includes source run, chat/evidence summary, root cause, fix summary, and verification.
- A pre-opened fallback PR link in case live Replicas or GitHub is slow during the demo.

Recommended secondary bug:

- Surface symptom: onboarding feels slow.
- Root cause: redundant API calls or sequential loading.
- Reproduction: load onboarding page and measure network waterfall.
- Fix: parallelize fetches or cache stable data.
- Verification: loading time drops below threshold.

Recommended product-role feature:

- Surface request: product wants an export progress indicator.
- Implementation: add job status and progress UI.
- Verification: progress state updates during export.

## 11. Implementation Plan

### Phase 1: Create Slack Intake

- Create a Slack app with `/reflex-bug-mode` and `/reflex-debug-mode` slash commands.
- Implement `/api/slack/reflex-bug-mode`.
- Implement `/api/slack/reflex-debug-mode`.
- Default `role` to `sales_csm` and `repo` to `https://github.com/yxshrk/electron`.
- Treat command text as optional.
- For bug mode, read the latest 100 channel messages and latest 3 attachments.
- For debug mode, return a recorder link and create a `debug` run.
- Reply immediately with a run ID and "started" status.
- Normalize the command into the internal `POST /api/runs` payload.
- Store fetched chat context and attachment metadata in InsForge.
- Draft a bug report and ask the user to confirm, edit, or add attachments in Slack.

Success criterion:

- A user can start a Reflex run from Slack and confirm the bug report in the bot update thread.

### Phase 2: Connect InsForge

- Run `npx @insforge/cli login`.
- Run `npx @insforge/cli link`.
- Run `npx @insforge/cli current` to verify the local project is linked.
- Install `@insforge/sdk`.
- Create the MVP tables with SQL migrations.
- Create a private storage bucket for screenshots, videos, screen recordings, and evidence logs.
- Use polling first; add InsForge Realtime only if there is time.

Success criterion:

- Runs, run events, observations, diagnoses, hypotheses, agent runs, and PR records persist in InsForge.

### Phase 3: Build the Happy Path

- Implement `POST /api/runs`.
- Implement `POST /api/runs/{runId}/context`.
- Implement `POST /api/runs/{runId}/debug-capture`.
- Implement `POST /api/runs/{runId}/media`.
- Implement `POST /api/runs/{runId}/draft-bug-brief`.
- Implement `POST /api/slack/interactions`.
- Implement `POST /api/runs/{runId}/confirm-bug-brief`.
- Implement `POST /api/runs/{runId}/intake-package`.
- Implement `POST /api/runs/{runId}/diagnose`.
- Implement `POST /api/runs/{runId}/dispatch-replicas`.
- Use a rehearsed transcript and seeded repo bug for deterministic behavior.
- Start with one confirmed agent path or a scripted sandbox run.
- Store each state transition in `reflex_runs.status` and append a `run_events` row.
- Post each state transition back into the Slack bot update thread.

Success criterion:

- The pipeline reaches `confirmed`, `reproduced`, and `fixed` for the primary seeded bug.

### Phase 4: Open the PR

- Create a branch through the GitHub API or local git automation.
- Commit the fix or demo patch.
- Open a PR with source run, reproduction evidence, and verification notes.
- Store the PR URL in InsForge.
- Post the PR as the final `Ship` stage in Slack.

Success criterion:

- The demo ends with a real PR link.

### Phase 5: Add the Tiny Dashboard

- Implement `/dashboard`.
- Implement `/dashboard/{runId}`.
- Implement `GET /api/runs`.
- Implement `GET /api/runs/{runId}`.
- Show all runs, diagnoses, current status, attachment count, and PR link in the first layer.
- Show confirmed report, chat history, attachments, debug artifacts, diagnosis, hypotheses, timeline, agent evidence, and PR verification in the detail layer.

Success criterion:

- Judges can click from a run list into one run and inspect every stored artifact used by the demo.

### Phase 6: Add Polish Only After the Spine Works

- Add the `/reflex-debug-mode` browser capture page with `getDisplayMedia` and microphone capture if the Slack bug-mode spine already works.
- Add richer screenshot/video upload handling to InsForge Storage.
- Add speech-to-text or a transcript input fallback for the optional web surface.
- Add InsForge Realtime status updates.
- Add parallel agent fan-out.

Success criterion:

- Polish improves the demo without becoming a dependency for the core flow.

### MVP Environment Variables

```text
NEXT_PUBLIC_APP_URL=
INSFORGE_PROJECT_URL=
INSFORGE_SERVICE_KEY=
SLACK_SIGNING_SECRET=
SLACK_BOT_TOKEN=
GITHUB_TOKEN=
DEFAULT_GITHUB_REPO=https://github.com/yxshrk/electron
MODEL_API_KEY=
```

Keep these values out of the browser unless they are explicitly public. Server-side API routes or edge functions should own all privileged Slack, InsForge, GitHub, model, and agent credentials.

## 12. Team Execution Plan

The team should split by interface boundaries, not by page sections. Each person should own one vertical path with a clear input and output contract.

### 12.1 Owners

| Owner | Primary Scope | Must Deliver | Depends On |
| --- | --- | --- | --- |
| Laurence | Slack front door | `/reflex-bug-mode`, `/reflex-debug-mode`, Slack context fetch, confirmation card, Slack thread status updates | Yash's run APIs and shared contracts |
| Yash | InsForge backend, debug capture storage, report draft, diagnosis, dashboard read model | `reflex_runs` and `run_events` schema, context/media/debug ingest, bug report draft, confirmed intake package, diagnosis, run status source of truth, `/dashboard` data | InsForge credentials and Slack payloads from Laurence |
| Luke | Seeded bug, Replicas dispatch, reproduction, fix, and PR | Deterministic export-hang fixture, scripted fallback PR, Replicas dispatch route, evidence payload, GitHub PR output | Confirmed intake package and hypothesis from Yash |

### 12.2 Workstream Contracts

Laurence to Yash:

```json
{
  "source": "slack",
  "mode": "bug",
  "role": "sales_csm",
  "repoUrl": "https://github.com/yxshrk/electron",
  "commandText": "",
  "chatHistoryMessages": [
    {
      "slackMessageTs": "1710000000.000100",
      "text": "Customer says export hangs on large reports."
    }
  ],
  "mediaArtifacts": [
    {
      "kind": "video",
      "storageUrl": "insforge://reflex-evidence/run_export_hang_01/export-crash.mov",
      "summary": "Export clicked, spinner appears, frontend crashes."
    },
    {
      "kind": "screenshot",
      "storageUrl": "insforge://reflex-evidence/run_export_hang_01/stuck-export.png",
      "summary": "Report export screen stuck in loading state."
    }
  ],
  "slackChannelId": "C123",
  "slackThreadTs": null
}
```

Yash to Laurence:

```json
{
  "runId": "run_export_hang_01",
  "bugBriefId": "brief_run_export_hang_01",
  "status": "needs_confirmation",
  "whereItHappens": "Report export screen",
  "actualBehavior": "When the user exports a large report, the frontend hangs or crashes.",
  "expectedBehavior": "The report export should complete or show progress without crashing.",
  "affectedSurface": "frontend",
  "evidenceSummary": [
    "Video shows export click, loading spinner, and frontend crash.",
    "Screenshot shows report export stuck in loading state."
  ],
  "missingInfo": [],
  "agentPromptPreview": "Investigate the report export flow. Confirm whether the frontend export handler blocks, crashes, or waits on an unbounded backend response before changing code."
}
```

Yash to Luke:

```json
{
  "runId": "run_export_hang_01",
  "repoUrl": "https://github.com/yxshrk/electron",
  "role": "sales_csm",
  "intakePackage": {
    "id": "pkg_run_export_hang_01",
    "chatHistoryMessageCount": 8,
    "mediaArtifactCount": 3
  },
  "confirmedReport": {
    "id": "brief_run_export_hang_01",
    "whereItHappens": "Report export screen",
    "actualBehavior": "When the user exports a large report, the frontend hangs or crashes.",
    "expectedBehavior": "The report export should complete or show progress without crashing.",
    "affectedSurface": "frontend",
    "evidenceSummary": [
      "Video shows export click, loading spinner, and frontend crash.",
      "Screenshot shows report export stuck in loading state."
    ],
    "agentPromptPreview": "Investigate the report export flow. The user reports that exporting a large report from the frontend hangs or crashes. Confirm whether the frontend export handler blocks, crashes, or waits on an unbounded backend response before changing code."
  },
  "symptom": "Report export hangs on large datasets",
  "hypotheses": [
    {
      "id": "hyp_1",
      "title": "Unbounded report query",
      "reproductionPlan": "Seed a large dataset and trigger report export",
      "expectedFailure": "Export request times out or spinner never resolves"
    }
  ]
}
```

Luke to Yash:

```json
{
  "runId": "run_export_hang_01",
  "hypothesisId": "hyp_1",
  "status": "shipped",
  "rootCause": "Report export loads all rows synchronously before writing the file.",
  "fixSummary": "Batch export rows and stream progress back to the UI.",
  "verification": "Large export fixture completes under the demo timeout.",
  "logsUrl": "https://...",
  "prUrl": "https://github.com/yxshrk/electron/pull/..."
}
```

### 12.3 Shared State Machine

Every pipeline stage should be stored on `reflex_runs.status` and mirrored in Slack.

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

Slack should never infer progress locally. Each thread update should come from the latest status stored in InsForge so retries, refreshes, and teammate actions stay consistent.

### 12.4 Build Order for Three People

1. Yash creates the InsForge schema, typed contracts, and `POST /api/runs`.
2. Laurence creates the Slack app, `/reflex-bug-mode`, `/reflex-debug-mode`, and Slack interactions against mocked run APIs.
3. Yash adds Slack context ingest, media ingest, debug capture ingest, and `POST /api/runs/{runId}/draft-bug-brief`.
4. Laurence wires the confirmation card: Confirm, Edit Report, and Add Attachment.
5. Yash adds `POST /api/runs/{runId}/confirm-bug-brief`, `POST /api/runs/{runId}/intake-package`, and `POST /api/runs/{runId}/diagnose`.
6. Luke creates the seeded bug path and scripted fallback that can produce a PR from a known fix.
7. Luke connects `POST /api/runs/{runId}/dispatch-replicas` and `POST /api/replicas/callback`.
8. Yash appends `run_events` on each state transition and exposes `GET /api/runs`, `GET /api/runs/{runId}`, and `GET /api/runs/{runId}/events`.
9. Laurence wires Slack thread updates to `reflex_runs.status` and `run_events` through the run event stream or polling.
10. Yash adds the tiny read-only `/dashboard` and `/dashboard/{runId}` views.
11. Everyone rehearses `/reflex-bug-mode` first, then adds `/reflex-debug-mode` only if the core spine is reliable.

### 12.5 Demo Ownership

| Demo Moment | Owner | Fallback |
| --- | --- | --- |
| Slack bug-mode command and attachment | Laurence | Use a static Slack message and screenshot URL |
| Slack debug-mode command and recorder link | Laurence / Yash | Use a pre-recorded video uploaded as a media artifact |
| Run creation and persistence | Yash | Use seeded run row in InsForge |
| Bug report confirmation | Laurence / Yash | Use a prefilled report and click Confirm |
| Confirmed intake package | Yash | Use seeded chat history and attachment records in InsForge |
| Diagnosis and hypothesis tree | Yash | Use deterministic hardcoded diagnosis from the confirmed package |
| Reproduction and fix evidence | Luke | Use precomputed logs and seeded patch |
| GitHub PR output | Luke | Use an already-open demo PR link |
| Dashboard run list and detail page | Yash | Use seeded InsForge rows and pre-uploaded artifacts |
| Final pipeline walkthrough | Laurence | Walk through Slack bot update thread updates and stored InsForge run states |

### 12.6 Missing Decisions

- Has the seeded export-hang bug been committed to `https://github.com/yxshrk/electron` with a deterministic failing repro?
- Who owns Vercel deployment for the webhook/API and tiny read-only dashboard?
- Is the primary demo input a Slack screenshot attachment, a recording attachment, or just fetched Slack history?
- Which fields are mandatory in the bug report before diagnosis: actual behavior, expected behavior, affected surface, and location?
- Which model path generates the diagnosis JSON: InsForge Model Gateway or a direct model API?
- What GitHub token can create branches and PRs for the demo repo?
- What InsForge project is linked, and who owns the project credentials?
- Is the agent path real, scripted, or hybrid for the first demo?
- What is the no-network fallback if the agent or GitHub API is slow?

### 12.7 Definition of Done

The MVP is done when the team can start from `/reflex-bug-mode` and reach a real or pre-authorized PR link with these artifacts persisted in InsForge. `/reflex-debug-mode` is done when the same backend flow works from a recording upload:

- Original Slack bug-mode report with default role `sales_csm`.
- Screenshot, Slack attachment, or debug recording reference.
- Confirmed intake package with bug report, chat history, debug artifacts, and attachments.
- Structured symptom.
- At least one hypothesis.
- Reproduction evidence.
- Fix summary.
- PR URL.
- Dashboard run detail showing the same chat history, attachments, timeline, diagnosis, evidence, and PR.

## 13. Build / Fake / Name Cuts

Build:

- Slack slash command and bot update thread updates.
- Minimal webhook/API routes.
- InsForge-backed run persistence.
- `run_events` timeline persistence.
- Bug report drafting and Slack confirmation.
- Debug-mode recording upload when time allows.
- Structured symptom to hypothesis tree for the rehearsed report.
- One deterministic reproduction path against a seeded repo.
- Minimal code fix or seeded patch.
- Pull request creation.
- Pipeline status in Slack.
- Tiny read-only dashboard with run list and run detail pages.

Fake:

- Open-ended speech robustness.
- Fully live multimodal interpretation for arbitrary screens.
- Pre-warmed sandbox startup where needed.
- Pre-indexed repository context.
- Parallel agent fan-out if programmatic access is slow.
- Pre-seeded dashboard rows if the live pipeline is slow.

Name:

- Always-on continuous watching.
- Enterprise multi-tenant controls.
- Full diagnostic memory improvement loop.
- Complete Vercel frontend dashboard.
- Mobile reproduction path through Limrun.
- Deep Slack workflow automation beyond the `/reflex-bug-mode` and `/reflex-debug-mode` commands.

## 14. Verification Strategy

### Functional Tests

- Diagnosis contract validates required fields.
- Bug report contract validates `where_it_happens`, `actual_behavior`, `affected_surface`, and confirmation status.
- Role lens changes generated agent brief.
- Hypotheses include reproduction plans.
- Agent run state transitions from pending to running to reproduced or rejected.
- PR metadata stores source run and evidence.

### Integration Tests

- Given a Slack sales transcript and screenshot/video evidence reference, diagnosis produces the expected symptom.
- Given a vague Slack report, Reflex drafts a bug report and waits for package confirmation before diagnosis.
- Given a structured export-hang symptom, the orchestrator dispatches expected sandbox tasks.
- Given a seeded large dataset, the reproduction command fails before the fix and passes after the fix.
- Given a successful fix, a PR record is created with verification notes.
- Given a stored run, `/dashboard/{runId}` shows the same chat history, attachments, timeline, diagnosis, evidence, and PR that Slack references.

### Demo Acceptance Test

The demo is ready when the team can run this script three times in a row:

1. Start from the Slack `/reflex-bug-mode` command.
2. Use the nearby Slack context and optional screenshot/video evidence.
3. Confirm or edit the drafted bug report in Slack.
4. Watch diagnosis and hypothesis updates appear in the Slack bot update thread.
5. Confirm at least one sandbox reproduces the bug.
6. Confirm the fix is generated.
7. Open the PR and show the evidence.
8. Open `/dashboard/{runId}` and show the stored context, timeline, diagnosis, evidence, and PR.

Debug mode is ready when the team can also run:

1. Start from `/reflex-debug-mode`.
2. Record or upload a reproduction video.
3. Click Done.
4. Confirm the generated bug report.
5. Reach the same diagnosis, Replicas dispatch, and PR flow.

## 15. Security and Privacy

The hackathon implementation is not production-ready for sensitive screen data, but it should still follow basic safety rules:

- Store only the screenshots/videos needed for the demo.
- Store only the Slack messages inside the configured context window, not the full channel history.
- Avoid capturing the entire desktop when a browser tab is enough.
- Redact obvious secrets from transcript text.
- Use scoped GitHub tokens for the demo repository only.
- Keep sandbox credentials separate from user-facing run data.
- Link PRs to evidence without exposing unnecessary screenshots/videos publicly.

Production requirements would include screenshot/video redaction, data retention controls, organization-level access control, audit logs, and explicit consent UX.

## 16. Technical Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Replicas programmatic dispatch is unavailable | Cannot automate parallel sandbox fan-out | Use manual or webhook-triggered task dispatch; keep one real sandbox path |
| Devin API access is unavailable | Cannot show second-agent handoff | Keep Devin as roadmap or manually queued executor |
| Slack command parsing is brittle | Intake fails during demo | Require no command arguments in the happy path; default role, repo, context, and media limits |
| Clarification prompt is too verbose | User ignores confirmation or agent prompt bloats | Keep the bug report to five fields plus one compact agent prompt preview |
| Multimodal extraction is unreliable | Diagnosis may drift | Use Slack text as the source of truth and attachments as supporting evidence |
| Browser capture permissions fail | Debug mode cannot record live | Upload a pre-recorded video through the same `debug_capture` artifact path |
| Sandbox startup is slow | Demo stalls | Pre-warm or show precomputed run if network fails |
| Agent fixes wrong code | Demo loses credibility | Use seeded bugs with deterministic tests |
| InsForge project is not linked before demo | Backend calls fail | Run `npx @insforge/cli current` during setup and keep a fallback project ready |
| Sponsor APIs differ from assumptions | Integration delays | Keep the complete Vercel dashboard, Devin, and Limrun outside the core dependency path; keep a scripted fallback if Replicas dispatch is unavailable |

## 17. Open Questions to Verify

- Does Replicas expose a programmatic API for dispatching agent tasks, or only integrations through Slack, Linear, GitHub, and similar tools?
- What is the fastest reliable way to pass a confirmed fix task into Devin during the hackathon?
- Which model path should generate diagnosis JSON while preserving sponsor alignment?
- Which InsForge project should be linked for the demo, and what service credentials should the webhook/API layer use?
- Which Slack workspace and bot credentials should receive the `/reflex-bug-mode` and `/reflex-debug-mode` commands?
- Do we want a mobile stretch demo, or should Limrun remain a roadmap extension only?
- Where is the tiny dashboard deployed: Vercel with the webhook/API, or local-only for the hackathon demo?
- What are the official judging criteria and sponsor-specific prize requirements on the day?

## 18. Hackathon Demo Script

Opening:

"Reflex fixes the handoff between the person who sees the bug and the engineer who has to prove and fix it."

Demo:

1. Run `/reflex-bug-mode` in the Slack channel right after the customer report.
2. Attach or reference a screenshot/recording of the stuck export screen if available.
3. Show the Reflex bot reply: run started.
4. Show the drafted bug report:
   - Where: report export screen.
   - Actual: exporting a large report hangs or crashes the frontend.
   - Expected: export completes or shows progress.
   - Surface: frontend.
5. Click Confirm in Slack.
6. Show the structured symptom: "Report export hangs on large datasets."
7. Show three hypotheses in the Reflex bot update thread.
8. Show the top hypothesis dispatched to Replicas.
9. Show the sandbox reproducing the hang.
10. Show the fix summary and passing verification.
11. Open the PR linked in the Reflex bot update thread.
12. Open `/dashboard/{runId}` and show the stored chat history, attachments, timeline, diagnosis, agent evidence, and PR metadata.

Optional debug-mode beat:

1. Run `/reflex-debug-mode`.
2. Open the recorder, reproduce the export hang, and click Done.
3. Show that Reflex generates the same style of confirmable bug report from the recording, transcript, screenshots, and notes.
4. Confirm the report and continue into the same package -> diagnosis -> Replicas -> PR flow.

Closer:

As an optional role-aware variant, run `/reflex-bug-mode role:ceo Reporting feels slow.` Reflex should produce a broader diagnosis with performance and workflow hypotheses instead of a narrow customer bug report. This proves the role can still change the engineering lens without making the default demo harder.

## 19. Success Criteria

The hackathon project is successful if judges see:

- A real source-of-truth Slack report with optional screen evidence.
- A confirmed intake package before diagnosis begins.
- A clear role-aware translation into engineering language.
- A ranked hypothesis tree.
- Parallel or sandboxed agent investigation.
- Reproduction evidence before the fix.
- A real PR that ties the fix back to the original report.
- A dashboard detail page showing the stored chat history, attachments, timeline, diagnosis, agent evidence, and PR metadata for the same run.

The minimum winning spine is:

```text
confirmed intake package -> structured symptom -> sandbox reproduction -> fix -> green PR
```

Everything before that spine can be scripted. Everything after that spine can be roadmap.

## 20. Sources

- InsForge Hackathon Luma page: https://luma.com/ainexus-t0fl
- InsForge docs introduction: https://docs.insforge.dev/introduction
- InsForge agent setup workflow: https://insforge.dev/skill.md
- InsForge database docs: https://docs.insforge.dev/core-concepts/database/overview
- InsForge storage docs: https://docs.insforge.dev/core-concepts/storage/overview
- InsForge realtime docs: https://docs.insforge.dev/core-concepts/realtime/overview
- Slack slash commands docs: https://docs.slack.dev/interactivity/implementing-slash-commands/
- Project concept notes provided during planning.
