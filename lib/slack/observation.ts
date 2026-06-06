import type { EvidenceSummaryItem } from '@/lib/insforge/types';

export interface SlackObservationRun {
  command_text: string;
}

export interface SlackObservationMessage {
  ts: string;
  userId?: string;
  text?: string;
  permalink?: string;
  hasFiles?: boolean;
  raw?: Record<string, unknown>;
}

export interface SlackObservation {
  transcript: string;
  visibleState: {
    source: 'slack_context';
    symptomSeed: string;
    evidenceSummary: EvidenceSummaryItem[];
    notes: string;
    messageCount: number;
    fileMessageCount: number;
  };
}

/**
 * Converts Slack command text and copied channel messages into Yash's observation contract.
 *
 * @param run Reflex run row fields needed for command text.
 * @param messages Slack context messages copied by Laurence's intake route.
 * @returns Observation payload consumed by the draft and diagnosis routes.
 * @sideEffects None.
 */
export function buildSlackObservation(
  run: SlackObservationRun,
  messages: SlackObservationMessage[]
): SlackObservation {
  const transcript = buildTranscript(run, messages);
  const symptomSeed = buildSymptomSeed(run, messages);
  const evidenceSummary = buildEvidenceSummary(run, messages);
  const fileMessageCount = messages.filter((message) => message.hasFiles).length;

  return {
    transcript,
    visibleState: {
      source: 'slack_context',
      symptomSeed,
      evidenceSummary,
      notes: firstNonEmpty([run.command_text, messages[0]?.text]) ?? 'Slack report',
      messageCount: messages.length,
      fileMessageCount,
    },
  };
}

/**
 * Builds a plain transcript from slash command text and Slack messages.
 *
 * @param run Reflex run row fields needed for command text.
 * @param messages Slack context messages copied by Laurence's intake route.
 * @returns Multi-line transcript for observation storage.
 * @sideEffects None.
 */
function buildTranscript(run: SlackObservationRun, messages: SlackObservationMessage[]): string {
  const lines: string[] = [];
  if (run.command_text.trim()) lines.push(`[command] ${run.command_text.trim()}`);
  for (const message of messages) {
    const text = message.text?.trim();
    if (!text) continue;
    lines.push(`[slack ${message.ts}${message.userId ? ` ${message.userId}` : ''}] ${text}`);
  }
  return lines.join('\n');
}

/**
 * Chooses a stable symptom seed from Slack text, normalizing the export-hang demo phrase.
 *
 * @param run Reflex run row fields needed for command text.
 * @param messages Slack context messages copied by Laurence's intake route.
 * @returns Symptom seed used by report drafting and diagnosis.
 * @sideEffects None.
 */
function buildSymptomSeed(run: SlackObservationRun, messages: SlackObservationMessage[]): string {
  const candidates = [run.command_text, ...messages.map((message) => message.text ?? '')]
    .map((text) => text.trim())
    .filter(Boolean);
  const joined = candidates.join(' ');

  if (/(export|download).*(hang|stuck|crash|freeze)|(?:hang|stuck|crash|freeze).*(export|download)/i.test(joined)) {
    return 'Report export hangs on large datasets';
  }

  return candidates[0] ?? 'Slack report needs clarification';
}

/**
 * Creates short evidence bullets from the command and the first few Slack messages.
 *
 * @param run Reflex run row fields needed for command text.
 * @param messages Slack context messages copied by Laurence's intake route.
 * @returns Evidence summary items stored on the observation.
 * @sideEffects None.
 */
function buildEvidenceSummary(
  run: SlackObservationRun,
  messages: SlackObservationMessage[]
): EvidenceSummaryItem[] {
  const summary: EvidenceSummaryItem[] = [];
  if (run.command_text.trim()) {
    summary.push({ kind: 'slack_command', summary: summarizeText(run.command_text) });
  }

  for (const message of messages) {
    if (summary.length >= 6) break;
    const text = message.text?.trim();
    if (!text) continue;
    summary.push({
      kind: message.hasFiles ? 'slack_message_with_file' : 'slack_message',
      summary: summarizeText(text),
    });
  }

  return summary;
}

/**
 * Returns the first non-empty string from a candidate list.
 *
 * @param values Candidate strings.
 * @returns First trimmed non-empty value, or undefined.
 * @sideEffects None.
 */
function firstNonEmpty(values: Array<string | undefined>): string | undefined {
  return values.map((value) => value?.trim()).find(Boolean);
}

/**
 * Truncates Slack text for compact evidence display.
 *
 * @param text Raw Slack text.
 * @returns Single-line summary capped at 180 characters.
 * @sideEffects None.
 */
function summarizeText(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > 180 ? `${normalized.slice(0, 177)}...` : normalized;
}
