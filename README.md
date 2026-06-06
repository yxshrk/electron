# Reflex

> **Tag who you are — sales, CEO, engineer — describe what's wrong while Reflex watches your screen, and it diagnoses the real engineering problem and dispatches coder agents to fix it. From a complaint to a merged PR, without a single ticket written.**

Reflex closes the gap between the people who hit bugs and the people who fix them. Everyone else starts from a ticket. You start from a human pointing at their screen.

## Why this wins

It clears all three bars judges score on:

- **Original** — the role-tagged, screen-aware front end is something no other team will build. You don't start from a ticket; you start from a person describing a problem out loud while sharing their screen.
- **Technically cool** — real-time multimodal screen understanding feeding an agentic reproduce-and-fix loop is a hard, legible system.
- **Sponsor-native** — every sponsor gets a load-bearing job, not a logo slot.

And it's defensible as a company: *"the gap between the people who hit bugs and the people who fix them"* is a real, expensive, universal problem.

## The reflex arc (core loop)

This is the architecture diagram.

1. **Watch** — user tags their role and shares their screen; Reflex captures what they're looking at (the broken export screen, the spinning loader, the 500 page).
2. **Listen** — they describe the problem in plain language ("every time I pull the big report it just hangs").
3. **Diagnose** — Reflex fuses what it sees + what they said + the codebase into a structured engineering symptom and a ranked hypothesis tree.
4. **Dispatch** — it spins up coder agents in sandboxes to chase the top hypotheses in parallel.
5. **Verify** — agents reproduce the bug in a sandbox (proof, not a guess), localize it, write the fix.
6. **Ship** — a green PR opens, linked back to the original screen + voice moment as the "source of truth."

## The special mechanic: the role tag changes the diagnostic lens

This is what makes it original rather than "voice-to-PR." The same complaint means different things from different roles, and Reflex translates accordingly:

| Role | What they describe | What Reflex does |
|---|---|---|
| **Sales / CSM** | A customer-facing symptom | Maps it to a reproducible technical fault |
| **CEO / founder** | A strategic frustration ("our onboarding feels slow") | Decomposes it into candidate engineering causes |
| **Product** | A desired behavior | Treats it as a feature spec and scaffolds it |
| **Engineer** | A technical symptom directly | Skips translation, goes straight to reproduction |

The role tag is a routing decision that sets the translation depth and the agent's brief. On stage, demoing two roles describing the *same* screen and getting two correctly-scoped engineering actions is the "oh, that's clever" beat.

## Architecture, sponsor-mapped (each one load-bearing)

- **Gemini (multimodal / live)** — *the eyes and ears.* Continuous screen frames + voice → structured symptom. The only thing that can do real-time screen + speech understanding, so it's mandatory, not decorative. (Also the riskiest piece — see the discipline note.)
- **Replicas** — *the engine and the proof.* Dispatches background coding agents (Claude Code / Codex) into sandboxed dev environments to reproduce, fix, and open PRs. Parallel hypothesis-chasing is the whole reason this isn't a toy: three sandboxes, three hypotheses, first one to reproduce wins.
- **Devin (Cognition)** — *the second executor.* Handles the heavier "implement the fix / feature" task once a hypothesis is confirmed, so you can show two agent systems collaborating (Replicas triages, Devin builds). Judges love seeing sponsors compose.
- **InsForge** — *the memory and the backend.* Holds codebase context, auth/storage, and — the graph lane — a growing map of "symptom → where it resolved," so the system gets smarter each session. This is the "real product" hook: accumulating institutional diagnostic memory.
- **Vercel / v0** — *the face.* The live pipeline visualization (the reflex arc lighting up node by node) and the role-tagged capture UI.
- **Limrun** *(optional stretch)* — if a symptom is about a mobile app, Limrun lets the agent reproduce it on a real iOS simulator. Powerful "we handle mobile too" beat — but cut it if time is tight.

## The hard part, and the discipline that protects you

Real-time screen capture + live voice is a transcription/vision science project that will eat your whole day if you let it. **Fake the front honestly:** capture is real (browser `getDisplayMedia` screen-share is cheap), but script the demo around one or two pre-rehearsed symptom descriptions rather than open-mic robustness. The screen + voice is framing; the diagnosis → reproduction → fix pipeline is the product. Spend your real engineering hours there.

## The rigor that survives a sharp judge

The stab a good judge takes: *"how do you go from a vague sentence to the right bug in a real codebase?"*

The answer: **you don't guess, you prove.** The agent's confidence is never an LLM opinion; it's *"I ran the export with a large dataset in a sandbox and it actually hung."* Reproduction is the proof. Own the ground truth: seed the demo repo with two or three real bugs that map to vague symptoms, so reproduction is verifiable and the trace is real.

## The demo arc (the movie)

A sales rep's voice plays over a shared screen of a spinning report: *"honestly the reporting's a nightmare, every time we pull the big exports it just hangs."*

On the projector, left to right, in real time:

> screen + words → structured symptom (*"report generation hangs on large datasets"*) → hypothesis tree (*unbounded query / missing pagination / timeout*) → Replicas agents fan out across sandboxes → one reproduces the hang → localizes the N+1 query → Devin implements the fix → green PR opens, linked to the original clip.

Ninety seconds, complaint to merged fix. **The kicker:** re-tag the same screen as "CEO" saying *"reports feel slow"* and watch the diagnosis re-scope. That's the closer.

## Build / fake / name tiering (the cut lines)

- **Build (real, non-negotiable):** the diagnosis → hypothesis → sandbox-reproduction → PR pipeline on a seeded repo. This must genuinely run.
- **Fake (scripted but live-looking):** screen capture + voice on rehearsed inputs; pre-indexed repo; pre-warmed sandboxes.
- **Name (talked about, not built):** continuous always-on watching, the InsForge symptom-memory getting smarter over time, Limrun mobile path, multi-tenant. Say it's the roadmap; don't build it today.

**Hard cut line if wifi dies:** reveal a pre-computed run instead of live execution. Never bet the demo on live sandbox spin-up over conference wifi.

## What to verify before writing the execution doc

- Replicas' exact dispatch surface and SDK for spinning up agents programmatically (vs. only from Slack/Linear/GitHub).
- Whether Gemini's live API accepts continuous screen frames + audio, or whether you periodically POST screenshots.
- InsForge's model-access and edge-function specifics for hosting the orchestration.
- Devin's API entry point for handing off a confirmed fix.

## The one thing that must be true

> If a Replicas agent can reproduce a seeded bug in a sandbox and open a real PR from a structured symptom, you have a winning demo even if everything in front of it is scripted.

Build that spine first, before you touch the screen-capture UI. The known failure mode is pivoting and front-loading the shiny part — resist it. **Spine first, face last.**
