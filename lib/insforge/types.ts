// Shared TypeScript contracts for the Reflex pipeline.
// Source of truth: developer_plans/shared-contracts.md section 4 (contract chain) and the
// reflex_runs migration. Laurence and Luke import from here - keep these stable.

export type RunStatus =
  | "created"
  | "context_stored"
  | "clarifying"
  | "report_drafted"
  | "package_confirmed"
  | "diagnosed"
  | "dispatched"
  | "reproduced"
  | "fixed"
  | "shipped"
  // failure states
  | "clarification_failed"
  | "diagnosis_failed"
  | "dispatch_failed"
  | "reproduction_failed"
  | "pr_failed";

export type RunMode = "bug" | "debug";
export type RunSource = "slack" | "web" | "manual";
export type Role = "sales_csm" | "ceo" | "product" | "engineer";

export type MediaKind =
  | "screenshot"
  | "video"
  | "screen_recording"
  | "audio_recording"
  | "transcript"
  | "log"
  | "other";

export type MediaSource =
  | "slack_file"
  | "debug_capture"
  | "manual_upload"
  | "replicas"
  | "manual";

// ---- C1: run creation (Laurence -> Yash) ----
export interface RunCreateInput {
  source: RunSource;
  mode: RunMode;
  role: Role;
  repoUrl: string;
  commandText?: string;
  slackChannelId?: string;
  slackThreadTs?: string | null;
  contextWindow?: {
    messageLimit: number;
    attachments: number;
    maxPromptChars: number;
  };
}

export interface RunCreateResult {
  runId: string;
  status: "created";
  recordingUrl?: string;
}

// ---- C2: report draft (Yash -> Laurence / recorder) ----
export type AffectedSurface = "frontend" | "backend" | "mobile" | "infra" | "unknown";

export interface EvidenceSummaryItem {
  kind: string;
  mediaArtifactId?: string;
  summary: string;
}

export interface ReportDraft {
  runId: string;
  bugBriefId: string;
  status: "needs_confirmation";
  whereItHappens: string;
  actualBehavior: string;
  expectedBehavior?: string;
  reproductionContext?: string;
  affectedSurface: AffectedSurface;
  evidenceSummary: EvidenceSummaryItem[];
  missingInfo: string[];
  agentPromptPreview: string;
}

// ---- C3: confirmed intake package ----
export interface IntakePackage {
  runId: string;
  intakePackageId: string;
  bugBriefId: string;
  confirmedReport: Record<string, unknown>;
  chatHistoryMessageCount: number;
  mediaArtifactCount: number;
  debugArtifactCount: number;
  status: "confirmed";
}

// ---- C4: dispatch handoff (Yash -> Luke) ----
export interface Hypothesis {
  id: string;
  title: string;
  reproductionPlan: string;
  expectedFailure: string;
}

export interface DispatchInput {
  runId: string;
  intakePackageId: string;
  repoUrl: string;
  role: string;
  symptom: string;
  hypothesis: Hypothesis;
}

// ---- C5: evidence (Luke -> Yash) ----
export interface EvidencePayload {
  runId: string;
  hypothesisId: string;
  status: "reproduced" | "fixed" | "shipped" | "reproduction_failed" | "pr_failed";
  rootCause: string;
  fixSummary: string;
  verification: string;
  logsUrl?: string;
  prUrl?: string;
  provider: "replicas" | "scripted";
}

// ---- C6: run event (Yash writes; Slack + dashboard read) ----
export interface RunEventInput {
  eventType: string;
  status?: RunStatus;
  title: string;
  detail?: string;
  payload?: Record<string, unknown>;
  actor?: string;
}

// ---- DB row shapes (snake_case, as returned by PostgREST) ----
export interface ReflexRunRow {
  id: string;
  run_key: string;
  source: RunSource;
  mode: RunMode;
  role: Role;
  repo_url: string;
  command_text: string;
  slack_channel_id: string | null;
  slack_thread_ts: string | null;
  context_window: { messageLimit: number; attachments: number; maxPromptChars: number };
  status: RunStatus;
  created_at: string;
  completed_at: string | null;
}

export interface MediaArtifactRow {
  id: string;
  run_id: string;
  artifact_key: string;
  kind: MediaKind;
  source: MediaSource;
  storage_url: string;
  slack_file_id: string | null;
  slack_message_ts: string | null;
  thumbnail_url: string | null;
  summary: string | null;
  safe_to_share: boolean;
  created_at: string;
}

export interface BugBriefRow {
  id: string;
  run_id: string;
  brief_key: string;
  where_it_happens: string;
  actual_behavior: string;
  expected_behavior: string | null;
  reproduction_context: string | null;
  affected_surface: string;
  evidence_summary: EvidenceSummaryItem[];
  missing_info: string[];
  agent_prompt_preview: string;
  status: string;
  created_at: string;
  confirmed_at: string | null;
}
