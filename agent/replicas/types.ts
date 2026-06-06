export type EvidenceStatus =
  | 'reproduced'
  | 'fixed'
  | 'shipped'
  | 'reproduction_failed'
  | 'pr_failed';

export interface DispatchInput {
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

export interface EvidencePayload {
  runId: string;
  hypothesisId: string;
  status: EvidenceStatus;
  rootCause: string;
  fixSummary: string;
  verification: string;
  logsUrl?: string;
  prUrl?: string;
  provider: 'replicas' | 'scripted';
}

export interface ReplicasTask {
  id: string;
  name: string;
  title: string;
  status: string;
  logsUrl?: string;
}

export interface DispatchResult {
  provider: 'replicas' | 'scripted';
  status: 'dispatched' | EvidenceStatus;
  taskName: string;
  taskTitle: string;
  prompt: string;
  replicasTask?: ReplicasTask;
  evidence?: EvidencePayload;
}

export interface ScriptedFallbackRun {
  branchName: string;
  dryRun: boolean;
  failingCommand: string;
  passingCommand: string;
  prBody: string;
  evidence: EvidencePayload;
}
