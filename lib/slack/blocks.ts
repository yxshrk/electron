// Block Kit builders for the Reflex Slack thread (docs/slack-bug-mode-mvp spec). Pure → testable.
// One bot message per run, chat.update'd in place as reflex_runs.status advances.

import type { ReportDraft, RunMode, RunStatus } from './contracts';

type Block = Record<string, unknown>;

// Pipeline stages in order (shared-contracts §2).
const STAGES: Array<{ status: RunStatus; label: string }> = [
  { status: 'created', label: 'Run created' },
  { status: 'context_stored', label: 'Context gathered' },
  { status: 'report_drafted', label: 'Report drafted' },
  { status: 'package_confirmed', label: 'Confirmed by you' },
  { status: 'diagnosed', label: 'Diagnosed' },
  { status: 'dispatched', label: 'Agent dispatched' },
  { status: 'reproduced', label: 'Bug reproduced' },
  { status: 'fixed', label: 'Fix written + tested' },
  { status: 'shipped', label: 'PR opened' },
];

const FAILURE: Record<string, string> = {
  clarification_failed: 'Could not assemble the report',
  diagnosis_failed: 'Diagnosis failed',
  dispatch_failed: 'Dispatch failed',
  reproduction_failed: 'Could not reproduce',
  pr_failed: 'PR creation failed',
};

// Map a failure to the last stage that genuinely completed.
const FAILURE_LAST_OK: Record<string, RunStatus> = {
  clarification_failed: 'context_stored',
  diagnosis_failed: 'package_confirmed',
  dispatch_failed: 'package_confirmed',
  reproduction_failed: 'dispatched',
  pr_failed: 'fixed',
};

function header(text: string): Block {
  return { type: 'header', text: { type: 'plain_text', text, emoji: true } };
}
function section(markdown: string): Block {
  return { type: 'section', text: { type: 'mrkdwn', text: markdown } };
}
function context(markdown: string): Block {
  return { type: 'context', elements: [{ type: 'mrkdwn', text: markdown }] };
}

/** First message after a slash command; we keep its ts and update it as status changes. */
export function ackBlocks(mode: RunMode, repoUrl: string): Block[] {
  const repo = repoUrl.replace(/^https?:\/\/github\.com\//, '');
  return [
    header(mode === 'bug' ? '🟡 Reflex — report' : '🟡 Reflex — record'),
    section(`*Repo:* \`${repo}\``),
    context(mode === 'bug' ? 'Gathering channel context and drafting a report…' : 'Spin up the recorder to capture the issue…'),
  ];
}

/** Record mode: a button linking to the browser recorder. */
export function recorderBlocks(runId: string, recorderUrl: string): Block[] {
  return [
    header('🎥 Reflex — record'),
    section('Record the issue in your browser (Slack can’t capture your screen). When you finish, Reflex drafts the report here.'),
    {
      type: 'actions',
      block_id: `recorder:${runId}`,
      elements: [
        {
          type: 'button',
          style: 'primary',
          text: { type: 'plain_text', text: 'Open Recorder', emoji: true },
          url: recorderUrl,
          action_id: 'reflex_open_recorder',
        },
      ],
    },
  ];
}

/** The live status timeline — rebuilt on every transition, chat.update'd in place. */
export function statusTimelineBlocks(current: RunStatus, detail?: string): Block[] {
  const failed = current in FAILURE;
  const currentIdx = STAGES.findIndex((s) => s.status === current);
  const lastOkIdx = failed ? STAGES.findIndex((s) => s.status === FAILURE_LAST_OK[current]) : -1;

  const lines = STAGES.map((stage, i) => {
    let icon = '◻️';
    if (failed) icon = i <= lastOkIdx ? '✅' : '◻️';
    else if (i < currentIdx) icon = '✅';
    else if (i === currentIdx) icon = '🔵';
    return `${icon}  ${stage.label}`;
  });

  const blocks: Block[] = [
    header(failed ? '🔴 Reflex hit a snag' : current === 'shipped' ? '🟢 Reflex shipped a fix' : '🟡 Reflex is working'),
    section(lines.join('\n')),
  ];
  if (failed) blocks.push(section(`*${FAILURE[current]}*${detail ? ` — ${detail}` : ''}`));
  else if (detail) blocks.push(context(detail));
  return blocks;
}

/** The confirmable report card with Confirm / Edit Report / Add Attachment. */
export function reportBlocks(draft: ReportDraft, contextLine?: string): Block[] {
  const evidence = draft.evidenceSummary.map((e) => `• _${e.kind}_ — ${e.summary}`).join('\n');
  const missing = draft.missingInfo.length ? draft.missingInfo.map((m) => `• ${m}`).join('\n') : '';

  const blocks: Block[] = [
    header('🔎 Does this bug report look right?'),
    section(`*Where it happens*\n${draft.whereItHappens}`),
    section(`*Actual behavior*\n${draft.actualBehavior}`),
  ];
  if (draft.expectedBehavior) blocks.push(section(`*Expected behavior*\n${draft.expectedBehavior}`));
  blocks.push(section(`*Affected surface*  \`${draft.affectedSurface}\``));
  if (evidence) blocks.push(section(`*Evidence*\n${evidence}`));
  if (missing) blocks.push(section(`*Missing info*\n${missing}`));
  blocks.push(section(`*Agent prompt preview*\n>${draft.agentPromptPreview.replace(/\n/g, '\n>')}`));
  blocks.push({
    type: 'actions',
    block_id: `report:${draft.runId}`,
    elements: [
      { type: 'button', style: 'primary', text: { type: 'plain_text', text: 'Confirm — go fix it', emoji: true }, action_id: 'reflex_confirm', value: draft.runId },
      { type: 'button', text: { type: 'plain_text', text: 'Edit Report', emoji: true }, action_id: 'reflex_edit', value: draft.runId },
      { type: 'button', text: { type: 'plain_text', text: 'Add Attachment', emoji: true }, action_id: 'reflex_add_attachment', value: draft.runId },
    ],
  });
  if (contextLine) blocks.push(context(contextLine));
  blocks.push(context('Confirming spends agent credits to reproduce + fix in a sandbox.'));
  return blocks;
}

/** Modal opened on Edit Report — prefilled with the editable fields. */
export function editModal(runId: string, draft: ReportDraft): Block {
  const input = (blockId: string, actionId: string, label: string, initial: string, multiline = true): Block => ({
    type: 'input',
    block_id: blockId,
    optional: true,
    label: { type: 'plain_text', text: label },
    element: { type: 'plain_text_input', action_id: actionId, multiline, initial_value: initial },
  });
  return {
    type: 'modal',
    callback_id: 'reflex_edit_submit',
    private_metadata: runId,
    title: { type: 'plain_text', text: 'Edit the report' },
    submit: { type: 'plain_text', text: 'Re-draft' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      input('where_block', 'where_input', 'Where it happens', draft.whereItHappens),
      input('actual_block', 'actual_input', 'Actual behavior', draft.actualBehavior),
      input('expected_block', 'expected_input', 'Expected behavior', draft.expectedBehavior ?? ''),
    ],
  };
}

/** Final card on the ship event. */
export function prCardBlocks(prUrl: string, summary?: string): Block[] {
  return [
    header('🟢 PR opened'),
    section(`${summary ? `${summary}\n\n` : ''}<${prUrl}|View the pull request →>`),
    context('Reproduced in a sandbox before fixing — the proof is in the PR.'),
  ];
}

/** Render the right blocks for an incoming RunEvent (timeline, or PR card on ship). */
export function blocksForEvent(ev: { status?: string; payload?: Record<string, unknown>; detail?: string }): Block[] {
  const prUrl = ev.payload?.prUrl as string | undefined;
  if (ev.status === 'shipped' && prUrl) return prCardBlocks(prUrl, ev.detail);
  return statusTimelineBlocks((ev.status as RunStatus) ?? 'created', ev.detail);
}
