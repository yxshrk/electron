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
function divider(): Block {
  return { type: 'divider' };
}
function fields(...pairs: string[]): Block {
  return { type: 'section', fields: pairs.map((text) => ({ type: 'mrkdwn', text })) };
}

/** First message after a slash command; we keep its ts and update it as status changes. */
export function ackBlocks(mode: RunMode, repoUrl: string): Block[] {
  const repo = repoUrl.replace(/^https?:\/\/github\.com\//, '');
  return [
    header(mode === 'bug' ? '🟡 Reflex is on it' : '🎥 Reflex — record mode'),
    fields(`*Repo*\n\`${repo}\``, `*Mode*\n${mode === 'bug' ? 'Report (from chat)' : 'Record (live)'}`),
    context(mode === 'bug' ? '🔄 Reading channel context and drafting a report…' : '🎬 Spin up the recorder to capture the issue…'),
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
  const doneCount = Math.min(failed ? lastOkIdx + 1 : currentIdx + 1, STAGES.length);

  // Consistent traffic-light circles read cleaner than mixed ✅/white-square glyphs.
  const lines = STAGES.map((stage, i) => {
    if (failed) {
      if (i <= lastOkIdx) return `🟢  ${stage.label}`;
      if (i === lastOkIdx + 1) return `🔴  *${stage.label}*`;
      return `⚪  ${stage.label}`;
    }
    if (i < currentIdx) return `🟢  ${stage.label}`;
    if (i === currentIdx) return `🔵  *${stage.label}*`;
    return `⚪  ${stage.label}`;
  });

  const bar = '▓'.repeat(doneCount) + '░'.repeat(STAGES.length - doneCount);
  const head = failed
    ? '🔴  Reflex hit a snag'
    : current === 'shipped'
      ? '🎉  Reflex shipped a fix'
      : '⚡  Reflex is on it';

  const blocks: Block[] = [
    header(head),
    context(`\`${bar}\`  *${doneCount}/${STAGES.length}*`),
    divider(),
    section(lines.join('\n')),
  ];
  if (failed) blocks.push(context(`:warning: *${FAILURE[current]}*${detail ? ` — ${detail}` : ''}`));
  else if (detail) blocks.push(context(`_${detail}_`));
  return blocks;
}

/** The confirmable report card with Confirm / Edit Report / Add Attachment. */
export function reportBlocks(draft: ReportDraft, contextLine?: string): Block[] {
  const evidence = draft.evidenceSummary.map((e) => `• *${e.kind}* — ${e.summary}`).join('\n');
  const missing = draft.missingInfo.length ? draft.missingInfo.map((m) => `• ${m}`).join('\n') : '';

  const blocks: Block[] = [header('🐞 Bug report — ready for your OK')];
  if (contextLine) blocks.push(context(`🧠 ${contextLine}`));
  blocks.push(divider());

  // Compact two-column metadata.
  blocks.push(fields(`*Where*\n${draft.whereItHappens}`, `*Surface*\n\`${draft.affectedSurface}\``));
  blocks.push(section(`*😕 Actual*\n${draft.actualBehavior}`));
  if (draft.expectedBehavior) blocks.push(section(`*✅ Expected*\n${draft.expectedBehavior}`));
  if (evidence) blocks.push(section(`*🔎 Evidence*\n${evidence}`));
  if (missing) blocks.push(section(`*❓ Still missing*\n${missing}`));

  blocks.push(divider());
  blocks.push(section(`*🤖 What the agent will be told*\n\`\`\`${draft.agentPromptPreview}\`\`\``));
  blocks.push({
    type: 'actions',
    block_id: `report:${draft.runId}`,
    elements: [
      { type: 'button', style: 'primary', text: { type: 'plain_text', text: '✅ Confirm — go fix it', emoji: true }, action_id: 'reflex_confirm', value: draft.runId },
      { type: 'button', text: { type: 'plain_text', text: '✏️ Edit Report', emoji: true }, action_id: 'reflex_edit', value: draft.runId },
      { type: 'button', text: { type: 'plain_text', text: '📎 Add Attachment', emoji: true }, action_id: 'reflex_add_attachment', value: draft.runId },
    ],
  });
  blocks.push(context('⚡ Confirming spends agent credits to reproduce + fix in a sandbox.'));
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
    header('🟢 Fix shipped'),
    divider(),
    section(`${summary ? `*${summary}*\n\n` : ''}🔗 <${prUrl}|View the pull request →>`),
    context('✅ Reproduced in a sandbox before fixing — the proof is in the PR.'),
  ];
}

/** Render the right blocks for an incoming RunEvent (timeline, or PR card on ship). */
export function blocksForEvent(ev: { status?: string; payload?: Record<string, unknown>; url?: string; detail?: string }): Block[] {
  // §8 /events puts the PR url top-level (`url`); shared-contracts put it in payload.prUrl — accept both.
  const prUrl = ev.url ?? (ev.payload?.prUrl as string | undefined);
  if ((ev.status === 'shipped' || prUrl) && prUrl) return prCardBlocks(prUrl, ev.detail);
  return statusTimelineBlocks((ev.status as RunStatus) ?? 'created', ev.detail);
}
