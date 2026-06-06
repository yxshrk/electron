// Wire contracts that cross the person boundary, mirrored from developer_plans/shared-contracts.md
// (branch docs/slack-bug-mode-mvp). Replace with imports from lib/insforge when Yash ships it.

export type Role = 'sales_csm' | 'ceo' | 'product' | 'engineer';
export const ROLES: Role[] = ['sales_csm', 'ceo', 'product', 'engineer'];

export type RunMode = 'bug' | 'debug';

export type RunStatus =
  | 'created' | 'context_stored' | 'clarifying' | 'report_drafted' | 'package_confirmed'
  | 'diagnosed' | 'dispatched' | 'reproduced' | 'fixed' | 'shipped'
  | 'clarification_failed' | 'diagnosis_failed' | 'dispatch_failed'
  | 'reproduction_failed' | 'pr_failed';

export const DEFAULT_REPO = 'https://github.com/yxshrk/electron';
export const DEFAULT_CONTEXT_WINDOW = { messageLimit: 100, attachments: 3, maxPromptChars: 6000 };

/** C1 — Laurence → Yash. POST /api/runs. */
export interface RunCreateInput {
  source: 'slack' | 'web' | 'manual';
  mode: RunMode;
  role: Role;
  repoUrl: string;
  commandText?: string;
  slackChannelId?: string;
  slackThreadTs?: string | null;
  contextWindow: { messageLimit: number; attachments: number; maxPromptChars: number };
}

export interface RunCreateResponse {
  runId: string;
  status: 'created';
  recordingUrl?: string;
}

// POST /api/runs/{runId}/context — field names per TECHNICAL_DOCUMENT.md §8.
export interface SlackContextCandidate {
  slackMessageTs: string;
  slackUserId?: string;
  text: string;
  permalink?: string;
  hasFiles?: boolean;
}

export interface SlackAttachment {
  slackFileId: string;
  slackMessageTs: string;
  kind: 'screenshot' | 'video' | 'recording' | 'file';
  filename: string;
}

/** POST /api/runs/{runId}/media — one file per call (TECHNICAL_DOCUMENT.md §8). */
export interface MediaArtifactInput {
  kind: 'screenshot' | 'video' | 'recording' | 'log' | 'file';
  source: 'slack_file' | 'recorder' | 'manual';
  storageUrl?: string;
  slackFileId?: string;
  summary?: string;
  safeToShare?: boolean;
}

/** POST /api/runs/{runId}/draft-bug-brief request body (§8). */
export interface DraftConfig {
  includeSlackHistory: boolean;
  messageLimit: number;
  includeAttachments: boolean;
  attachmentLimit: number;
  includeDebugCapture: boolean;
  maxPromptChars: number;
}

/** POST /api/runs/{runId}/confirm-bug-brief request body (§8). */
export interface ConfirmInput {
  bugBriefId?: string;
  editedFields?: Record<string, string>;
  additionalMediaArtifactIds?: string[];
  confirmedBy?: string;
}

/** C2 — Yash → Laurence. The confirmable report. */
export interface ReportDraft {
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

/** C3 — confirmation result. */
export interface IntakePackage {
  runId: string;
  intakePackageId: string;
  bugBriefId: string;
  confirmedReport: Record<string, unknown>;
  chatHistoryMessageCount: number;
  mediaArtifactCount: number;
  debugArtifactCount: number;
  status: 'confirmed';
}

/** C6 — Yash → Laurence. Status stream item (GET /api/runs/{runId}/events). */
export interface RunEvent {
  runId: string;
  eventType: string;
  status?: RunStatus | string;
  title: string;
  detail?: string;
  payload?: Record<string, unknown>;
  url?: string;      // §8 /events puts the PR url here on pr.opened
  actor?: string;
  createdAt?: string;
}
