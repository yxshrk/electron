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
  slackUserId?: string;
  contextWindow: { messageLimit: number; attachments: number; maxPromptChars: number };
}

export interface RunCreateResponse {
  runId: string;
  status: 'created';
  recordingUrl?: string;
}

export type MediaKind =
  | 'screenshot' | 'video' | 'screen_recording' | 'audio_recording' | 'transcript' | 'log' | 'other';

// POST /api/runs/{runId}/context — matches Yash's route (PR #8): { messages: SlackMessage[] }.
// NOTE: his handler reads `ts`/`userId` (not slackMessageTs/slackUserId — the §8 doc is wrong).
export interface SlackContextCandidate {
  ts: string;
  userId?: string;
  text: string;
  permalink?: string;
  hasFiles?: boolean;
}

// Gathered for the context line + future /media upload — NOT sent to /context (his route ignores it).
export interface SlackAttachment {
  slackFileId: string;
  slackMessageTs: string;
  kind: MediaKind;
  filename: string;
}

/** POST /api/runs/{runId}/media — one file per call; storageUrl REQUIRED (PR #8). */
export interface MediaArtifactInput {
  kind: MediaKind;
  storageUrl: string;
  slackFileId?: string;
  slackMessageTs?: string;
  thumbnailUrl?: string;
  summary?: string;
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
