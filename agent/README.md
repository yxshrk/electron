# Reflex — agent-dispatch path (Laurence's workstream)

Turns one hypothesis into a reproduced bug + a green PR, and returns the evidence payload
`/api/dispatch` expects. Two interchangeable paths behind the same `EvidencePayload` shape:

| Path | When | How |
|---|---|---|
| **Replicas** (`replicas/dispatch.ts`) | Live demo, real agent | `POST /v1/replica` → SSE stream → PR |
| **Scripted** (`replicas/scripted-fallback.ts`) | Wifi/credits flaky | pre-known fix on the seeded repo → `gh pr create` |

## Contracts (TECHNICAL_DOCUMENT.md §12.2)

**In** (Luke → me): `DispatchInput` — `sessionId, repoUrl, role, symptom, hypothesis{id,title,reproductionPlan,expectedFailure}, environmentId?`

**Out** (me → Luke): `EvidencePayload` — `sessionId, hypothesisId, status, rootCause, fixSummary, verification, logsUrl, prUrl, provider`

`status` ∈ `shipped | reproduced | reproduction_failed | pr_failed`.

## Run it

```bash
cd agent && npm install
cp .env.example .env        # add REPLICAS_API_KEY once the org admin claims credits

npm run dispatch:dry        # prints the agent brief, no API call (works without a key)
npm run dispatch examples/dispatch-input.json   # live dispatch; evidence JSON on stdout
```

`stdout` is **only** the evidence JSON — pipe it straight into the orchestrator. Progress
events go to `stderr`.

## Wiring into Luke's `/api/dispatch`

```ts
import { dispatchHypothesis } from '../../agent/replicas/dispatch';

const evidence = await dispatchHypothesis(input, {
  onEvent: (e) => publishToInsforge(input.sessionId, e), // pipeline dashboard
});
// persist evidence in InsForge, flip capture_sessions.status -> evidence.status
```

## Setup still gated on a human (org admin, browser)

1. One teammate becomes Replicas **org admin**, creates an account.
2. Claim at `tryreplicas.com/dashboard/insforge-hackathon`, code **`ainexus`** (3600 credits, one per org).
3. Create an API key → drop into `agent/.env`.
4. Install the **Replicas GitHub App** on the seeded demo repo (so the agent can open PRs).
5. Build one **Environment** bound to the seeded repo (clone + `npm install` + stage the
   reproduction command as a Start Hook); put its id in `environmentId`.

Until then the **scripted path** runs the whole demo with zero Replicas dependency.

See `../STACK_RESEARCH.md` §1 for the full verified Replicas API surface.
