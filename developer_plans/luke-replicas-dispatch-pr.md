# Luke - Replicas Dispatch and PR

## Mission

Own the proof path. Take one confirmed hypothesis, reproduce the bug in a sandbox or scripted
fallback, apply the fix, open a GitHub PR, and return evidence to the run.

You do not own Slack or diagnosis. Your input is `DispatchInput`; your output is `EvidencePayload`.

## Product Flow You Own

```text
confirmed intake package
  -> diagnosis + top hypothesis
  -> DispatchInput
  -> Replicas task or scripted fallback
  -> reproduction evidence
  -> fix
  -> GitHub PR
  -> EvidencePayload back to InsForge
```

## What You Produce

| Output | Shape | Consumer |
| --- | --- | --- |
| Dispatch route | `POST /api/runs/{runId}/dispatch-replicas` | Yash |
| Agent brief builder | `DispatchInput -> Replicas prompt` | Replicas/scripted fallback |
| Progress events | provider events mapped to run status | Yash / Laurence |
| Evidence payload | `EvidencePayload` | Yash |
| PR | GitHub PR against `yxshrk/electron` | User / judges |

## What You Consume

| Input | From | Purpose |
| --- | --- | --- |
| Confirmed run | Yash | Ensure user approved the bug report |
| `DispatchInput` | Yash | Agent task definition |
| Replicas credentials | Setup | Live sandbox execution |
| Seeded repo | Shared | Deterministic demo bug and fix |

## Owned Files

```text
agent/replicas/types.ts
agent/replicas/client.ts
agent/replicas/prompt.ts
agent/replicas/dispatch.ts
agent/replicas/scripted-fallback.ts
agent/run.ts
agent/examples/dispatch-input.json
app/api/runs/[runId]/dispatch-replicas/route.ts
app/api/replicas/callback/route.ts
```

Keep shared contract names aligned with `developer_plans/shared-contracts.md`.
Use the Replicas Agent Prompt and PR Body Template in `TECHNICAL_DOCUMENT.md` as the canonical
templates for `agent/replicas/prompt.ts` and the scripted fallback PR body.

## Dispatch Contract

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

Rules:

- Only dispatch after the run reaches `package_confirmed` and diagnosis exists.
- Start with one top hypothesis for the MVP.
- Parallel fan-out is a stretch feature.
- Keep a scripted fallback that can produce a real PR without Replicas availability.

## Evidence Contract

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

This payload should be persisted into `agent_runs` and `pull_requests`, then reflected in
`reflex_runs.status`.

## Replicas Integration

Live path:

- `POST /v1/replica`
- auth with `REPLICAS_API_KEY`
- include the required Replicas API version header if live docs/setup require it
- use a prebuilt environment bound to `https://github.com/yxshrk/electron`
- stream events or consume callbacks
- extract PR URL, logs, and reproduction evidence

The exact live Replicas setup can be finished after the scripted fallback works.

## Scripted Fallback

Build this first.

Goal:

```text
DispatchInput -> known export-hang reproduction notes -> known patch -> GitHub PR -> EvidencePayload
```

Requirements:

- Use a fresh branch.
- Apply the smallest known fix for the seeded export-hang bug.
- Include reproduction notes and verification in the PR body.
- Return an `EvidencePayload` with `provider: "scripted"` and `status: "shipped"`.
- Keep this path independent from Slack, InsForge model output, and Replicas availability.

## Seeded Demo Bug

Primary bug:

```text
Large report export hangs or crashes.
```

Reproduction shape:

- seed a large dataset
- trigger report export
- prove the export times out, spins forever, or crashes before the fix
- apply a bounded query, pagination, streaming, or timeout-safe path
- verify export completes under the demo timeout

Required artifacts:

- failing repro command or test that fails before the fix
- seeded data fixture large enough to trigger the failure deterministically
- known minimal patch for `scripted-fallback.ts`
- verification command that passes after the fix
- PR body template with source run, evidence summary, root cause, fix summary, and verification
- pre-opened fallback PR link in case live Replicas or GitHub is slow

The demo should show proof. The PR should not look like a guess from a vague prompt.

## Status Mapping

Map agent progress back to the shared state machine:

```text
dispatched
reproduced
fixed
shipped
```

Failure states:

```text
dispatch_failed
reproduction_failed
pr_failed
```

Yash persists the state and Laurence renders it in Slack.

## Build Plan

1. Update `agent/replicas/types.ts` and samples to use `runId` and `intakePackageId`.
2. Build the dry-run prompt formatter from `DispatchInput` using the canonical Replicas Agent Prompt.
3. Add the deterministic export-hang fixture, failing repro command, and verification command.
4. Build the scripted fallback PR path.
5. Implement `POST /api/runs/{runId}/dispatch-replicas`.
6. Implement `POST /api/replicas/callback`.
7. Add live Replicas dispatch if credentials/environment are ready.
8. Rehearse the PR path with a pre-opened fallback PR available.

## Demo Fallbacks

| Layer | Real Path | Fallback |
| --- | --- | --- |
| Dispatch | Live Replicas | Scripted fallback |
| Reproduction | Sandbox command output | Precomputed logs |
| Fix | Agent-authored patch | Known seeded patch |
| PR | Replicas GitHub App | `gh pr create` from fallback branch |
| Final evidence | Live callback | Seeded `EvidencePayload` |

## References

- Shared contracts: [`shared-contracts.md`](./shared-contracts.md)
- Main technical plan: [`../TECHNICAL_DOCUMENT.md`](../TECHNICAL_DOCUMENT.md)
