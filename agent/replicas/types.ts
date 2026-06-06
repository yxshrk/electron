// Shared types for the Reflex agent-dispatch path (Laurence's workstream).
// Contracts mirror TECHNICAL_DOCUMENT.md §12.2.

/** What Luke's /api/dispatch hands us (one hypothesis at a time). */
export interface DispatchInput {
  sessionId: string;
  repoUrl: string;
  role: string;
  symptom: string;
  hypothesis: {
    id: string;
    title: string;
    reproductionPlan: string;
    expectedFailure: string;
  };
  /** Pre-built Replicas Environment bound to the seeded repo (clone + deps via Start Hooks). */
  environmentId?: string;
}

/** What we return to Luke once the agent has shipped (or failed). */
export interface EvidencePayload {
  sessionId: string;
  hypothesisId: string;
  status: 'shipped' | 'reproduced' | 'reproduction_failed' | 'pr_failed';
  rootCause: string;
  fixSummary: string;
  verification: string;
  logsUrl: string;
  prUrl: string;
  /** Which path produced this — useful for the demo + debugging. */
  provider: 'replicas' | 'scripted';
}

/** Subset of the Replicas replica object we rely on (see docs.tryreplicas.com). */
export interface Replica {
  id: string;
  status: 'preparing' | 'active' | 'sleeping' | 'error';
  pull_requests?: Array<{ repository: string; number: number; url: string }>;
  repository_statuses?: Array<{
    repository: string;
    branch?: string;
    pr_urls?: string[];
    git_diff?: string;
  }>;
}

/** SSE envelope from GET /v1/replica/{id}/events. */
export interface ReplicaEvent {
  id: string;
  ts: string;
  type: string; // e.g. chat.turn.completed, hooks.completed, repo.status.changed
  payload: any;
}

export type EventHandler = (event: ReplicaEvent) => void;
