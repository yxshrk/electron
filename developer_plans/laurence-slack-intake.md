# Laurence — Slack Intake & Status (the front door)

> **Mission:** Own the entire human-facing surface in Slack. Turn a `/reflex` slash command + any
> attached screenshot/recording into a normalized `IntakePayload` (C1), then keep the Slack thread
> live as the pipeline runs — including the Confirm/Edit moment where the user approves the brief.
>
> You are the **only** person who touches Slack. You depend on Yash's `/api/intake` and status
> stream; you depend on nothing from Luke directly.

Anchored to: [`shared-contracts.md`](./shared-contracts.md) · `TECHNICAL_DOCUMENT.md` §6 (Slack
Intake), §8 (`POST /api/slack/commands`), §12.2 · slack-first draft (`docs/slack-first-mvp`).

```text
  ┌──────────────────────┐
  │  LAURENCE — Slack ◄── YOU ARE HERE
  ├──────────────────────┤        C1 IntakePayload          C2 StatusEvent / BriefDraft
  │ /reflex slash cmd     │  ───────────────────────►  Yash  ◄───────────────────────
  │ attachments → storage │
  │ thread status updates │   (you never call Luke directly — Yash mediates)
  │ confirm / edit buttons│
  └──────────────────────┘
```

---

## 1. What the rest of the app expects FROM you

| You must produce | Shape | Consumer |
|---|---|---|
| A normalized intake call | `POST /api/intake` with `IntakePayload` (C1) | Yash |
| Uploaded media in InsForge Storage | `storageKey` per attachment, path `sessions/{sessionId}/...` | Yash (reads for extraction) |
| A confirm/edit decision | `POST /api/sessions/{id}/confirm` (on Confirm) or re-`diagnose` (on Edit) | Yash |
| Nothing else | — | — |

## 2. What you expect FROM the rest of the app

| You consume | From | Shape |
|---|---|---|
| `sessionId` + initial status | Yash `/api/intake` response | `{ sessionId, status: 'created' }` |
| The brief to show the user | Yash `BugBriefDraft` (C2a) | symptom + evidence + hypotheses + `needsConfirmation` |
| Live pipeline status | Yash `StatusEvent` stream (C2b) | `GET /api/sessions/{id}/events` (SSE) or poll `GET /api/sessions/{id}` |
| The final PR URL | `StatusEvent { type: 'pr.opened', prUrl }` | render as the last thread message |

> You never see `DispatchInput`/`EvidencePayload` — those are Yash↔Luke. You only ever render the
> `StatusEvent` projection Yash publishes.

---

## 3. Owned surface

```text
app/api/slack/reflex-command/route.ts   # slash command → IntakePayload → POST /api/intake
app/api/slack/events/route.ts           # file_shared / message events → upload media, attach to session
app/api/slack/interactions/route.ts     # Confirm/Edit block-action handlers
lib/slack/client.ts                     # Slack Web API client (chat.postMessage, chat.update, files)
lib/slack/blocks.ts                     # Block Kit builders: brief card, status timeline, PR card
lib/slack/verify.ts                     # Slack request signature verification
```

Env you own (shared-contracts §7): `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_APP_TOKEN`.

You **import** `lib/insforge/` (Yash's client + types) for storage upload + reading session state —
but you do not edit it.

---

## 4. The `/reflex` command grammar

Match TECHNICAL_DOCUMENT.md §8 example, extended with role tagging (§5):

```text
/reflex role:sales repo:https://github.com/yxshrk/electron Customer says export hangs on large reports.
```

Parse into C1:
- `role:` → `IntakePayload.role` (validate ∈ sales|ceo|product|engineer; default `engineer`).
- `repo:` → `repoUrl` (default the demo repo `https://github.com/yxshrk/electron`).
- remaining free text → `transcript`.
- the originating channel + `thread_ts` + `user` → `slackContext`.

If the user dropped a screenshot in the same message, the `file_shared` event (`/events`) carries
it — upload to InsForge Storage and add to `media[]` before (or just after) the intake call.

---

## 5. Build plan (phased)

### Phase L0 — Slack app + local tunnel (do first, ~30 min)
- Create a Slack app (manifest below), install to the workspace, grab `SLACK_BOT_TOKEN` +
  `SLACK_SIGNING_SECRET`.
- Scopes: `commands`, `chat:write`, `files:read`, `files:write`, `groups:history`,
  `channels:history`.
- Point the slash command + interactivity + events Request URLs at your dev tunnel
  (`ngrok`/`cloudflared` → `NEXT_PUBLIC_APP_URL`).
- **Success:** `/reflex hello` hits your route and you `chat.postMessage` "👋 Reflex received."

### Phase L1 — Intake against a MOCK (unblocked by Yash)
- Implement `/api/slack/reflex-command`: verify signature → parse grammar → build `IntakePayload`.
- POST it to a **local mock** of `/api/intake` that returns `{ sessionId: "sess_mock", status: "created" }`
  (the C1 contract). Wire the real endpoint when Yash ships it.
- Immediately `chat.postMessage` a **status timeline** message in-thread and stash its `ts` (you'll
  `chat.update` this same message as status changes — one tidy card, not spam).
- **Success:** `/reflex role:sales repo:... export hangs` posts a "Reflex is on it" card with the
  parsed role + repo echoed back.

### Phase L2 — Media attachments → Storage
- Handle `file_shared`/`message.file_share` in `/api/slack/events`: download via `files.info` URL
  (auth header = bot token) → `lib/insforge` storage upload to `reflex-evidence` at
  `sessions/{sessionId}/screenshot-{ts}.png` → push `{ kind, storageKey, url }` into the session's
  media (via Yash's `POST /api/sessions/{id}/observations`, or include in the initial intake if the
  file arrives with the command).
- **Success:** a screenshot dropped with `/reflex` shows up in InsForge Storage under the session.

### Phase L3 — The confirm/edit loop (your signature UX beat)
- When Yash emits `brief.ready` (C2 StatusEvent) / returns a `BugBriefDraft`, render a **Block Kit
  brief card**: symptom, evidence bullets, top hypotheses, and two buttons:
  - **Confirm** → `POST /api/sessions/{id}/confirm` (Yash flips to `confirmed`, then Luke dispatches).
  - **Edit** → open a modal prefilled with the symptom; on submit, send the edited text back to
    Yash's `diagnose` to regenerate (keeps the human in the loop, TECHNICAL_DOCUMENT.md §5).
- Handle both in `/api/slack/interactions` (verify signature; ack within 3s; do work async).
- **Success:** clicking Confirm advances the pipeline; clicking Edit re-runs diagnosis with the
  user's wording.

### Phase L4 — Live status thread
- Subscribe to Yash's `StatusEvent` stream (SSE `GET /api/sessions/{id}/events`, or poll
  `GET /api/sessions/{id}` every ~2s while not terminal).
- `chat.update` the timeline card on each transition: observe → diagnose → confirm → dispatch →
  reproduce → fix → ship. Render failure states (`*_failed`) as a red line with the detail.
- On `pr.opened`, post a final **PR card** with the `prUrl` and a link back to the original message.
- **Success:** the thread animates through all stages and ends on a clickable PR.

---

## 6. Mocking strategy (so you never wait on Yash/Luke)

- **Yash's `/api/intake` + status:** keep a `lib/slack/__mocks__/reflex-backend.ts` that returns a
  canned `sessionId` and replays a scripted sequence of `StatusEvent`s on a timer. Build your entire
  thread UX against it; flip an env flag to hit the real backend.
- **The brief:** hardcode one `BugBriefDraft` for the rehearsed "export hangs" transcript so you can
  build the confirm card before diagnosis exists.

## 7. Testing

- Signature verification rejects a forged request (unit).
- Grammar parser: role/repo/transcript extraction incl. defaults + a malformed command.
- Block Kit cards render for: created, brief-ready, each status, each failure, pr.opened.
- Idempotency: a duplicate Slack retry (same `event_id`) does not double-post or double-dispatch.

## 8. Fallbacks (build / fake / name — TECHNICAL_DOCUMENT.md §13, §12.5)

| Layer | Build (real) | Fake (scripted) | Name (roadmap) |
|---|---|---|---|
| Intake | real slash command + signature verify | rehearsed command text | open-mic / DM intake |
| Media | real Slack file → Storage upload | pre-uploaded screenshot keyed to the session | video/recording transcription |
| Status thread | real `chat.update` from StatusEvents | replay scripted events on a timer | rich per-stage Slack Canvas |
| Confirm | real Block Kit buttons | auto-confirm after N seconds | multi-step edit/approval workflow |

**Demo fallback (§12.5):** if Slack interactivity flakes, post a static pre-rendered thread and walk
through the stored InsForge session states.

## 9. Demo ownership (TECHNICAL_DOCUMENT.md §12.5, §18)

You own **"the report comes in and the thread tells the story."** The closer — re-running the same
screen as `role:ceo` and watching the diagnosis re-scope (§18) — is triggered by you firing a second
`/reflex role:ceo` on the same repo. Rehearse both role commands.

## 10. Minimal Slack app manifest (starting point)

```yaml
display_information:
  name: Reflex
features:
  bot_user:
    display_name: reflex
  slash_commands:
    - command: /reflex
      url: https://YOUR_TUNNEL/api/slack/reflex-command
      description: Report a bug to Reflex
      usage_hint: "role:sales repo:<url> <what's wrong>"
oauth_config:
  scopes:
    bot: [commands, chat:write, files:read, files:write, channels:history, groups:history]
settings:
  interactivity:
    is_enabled: true
    request_url: https://YOUR_TUNNEL/api/slack/interactions
  event_subscriptions:
    request_url: https://YOUR_TUNNEL/api/slack/events
    bot_events: [file_shared, message.channels]
```

## 11. References
- Contracts: [`shared-contracts.md`](./shared-contracts.md) §3 (C1, C2), §5 (storage), §6 (routes).
- Architecture: `TECHNICAL_DOCUMENT.md` §6 (Slack Intake / Bug Brief Builder), §8 (intake API),
  §12.2–12.5 (contracts, build order, demo), §18 (demo script).
- API research: `STACK_RESEARCH.md` (slack-first draft on `docs/slack-first-mvp`).
