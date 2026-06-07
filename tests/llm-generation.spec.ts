import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildReportDraftUserPrompt,
  draftReportWithLLM,
  REPORT_DRAFT_SYSTEM_PROMPT,
  type ReportModelClient,
} from '../lib/diagnosis/report';
import {
  buildDiagnosisUserPrompt,
  diagnoseWithLLM,
  DIAGNOSIS_SYSTEM_PROMPT,
  type DiagnosisModelClient,
} from '../lib/diagnosis/diagnose';
import type { SegmentResult } from '../lib/diagnosis/segment';

const segment: SegmentResult = {
  symptomSeed: 'Checkout submit fails after clicking Pay',
  visibleState: {
    screen: 'checkout',
    ui: 'payment form shows a spinner',
  },
  evidenceSummary: [
    {
      kind: 'log',
      summary: 'Network: POST /api/checkout returned 500 after clicking Pay',
    },
  ],
};

test('bug report drafting uses the configured LLM when a model key is available', async (t) => {
  const previousModel = process.env.REFLEX_REPORT_MODEL;
  process.env.REFLEX_REPORT_MODEL = 'test/report-model';
  t.after(() => {
    restoreEnv('REFLEX_REPORT_MODEL', previousModel);
  });

  let call: Parameters<ReportModelClient['chatJSON']>[0] | undefined;
  const client: ReportModelClient = {
    hasModelKey: () => true,
    chatJSON: async <T,>(args: Parameters<ReportModelClient['chatJSON']>[0]): Promise<T> => {
      call = args;
      return {
        whereItHappens: 'Checkout payment form',
        actualBehavior: 'Clicking Pay leaves the checkout spinner running and the request returns 500.',
        expectedBehavior: null,
        reproductionContext: 'Customer checkout with a saved card token.',
        affectedSurface: 'backend',
        evidenceSummary: [
          {
            kind: 'log',
            summary: 'POST /api/checkout returned 500 after clicking Pay.',
          },
        ],
        missingInfo: ['Exact customer account is not known'],
        agentPromptPreview: 'Investigate checkout payment submission returning 500 after Pay is clicked.',
      } as T;
    },
  };

  const report = await draftReportWithLLM(
    {
      role: 'sales_csm',
      repoUrl: 'https://github.com/yxshrk/electron',
      commandText: '/reflex-report checkout fails when customer pays',
      notes: 'Customer says checkout is broken.',
      segment,
      slackMessages: [
        {
          slack_message_ts: '1710000000.000001',
          slack_user_id: 'U123',
          text: 'Customer cannot pay on checkout.',
          has_files: true,
        },
      ],
    },
    client
  );

  assert.equal(call?.system, REPORT_DRAFT_SYSTEM_PROMPT);
  assert.equal(call?.model, 'test/report-model');
  assert.match(call?.user ?? '', /Slack context:/);
  assert.match(call?.user ?? '', /Customer cannot pay on checkout/);
  assert.equal(report.whereItHappens, 'Checkout payment form');
  assert.equal(report.actualBehavior, 'Clicking Pay leaves the checkout spinner running and the request returns 500.');
  assert.equal(report.expectedBehavior, undefined);
  assert.equal(report.affectedSurface, 'backend');
  assert.equal(report.missingInfo[0], 'Exact customer account is not known');
});

test('bug report drafting falls back when no model key is available', async () => {
  const client: ReportModelClient = {
    hasModelKey: () => false,
    chatJSON: async () => {
      throw new Error('chatJSON should not be called without a model key');
    },
  };

  const report = await draftReportWithLLM(
    {
      role: 'sales_csm',
      repoUrl: 'https://github.com/yxshrk/electron',
      segment: {
        ...segment,
        symptomSeed: 'Report export hangs on large datasets',
      },
    },
    client
  );

  assert.equal(report.whereItHappens, 'Report export screen');
  assert.match(report.agentPromptPreview, /report export flow/i);
});

test('diagnosis uses the configured LLM when a model key is available', async (t) => {
  const previousModel = process.env.REFLEX_DIAGNOSIS_MODEL;
  process.env.REFLEX_DIAGNOSIS_MODEL = 'test/diagnosis-model';
  t.after(() => {
    restoreEnv('REFLEX_DIAGNOSIS_MODEL', previousModel);
  });

  let call: Parameters<DiagnosisModelClient['chatJSON']>[0] | undefined;
  const client: DiagnosisModelClient = {
    hasModelKey: () => true,
    chatJSON: async <T,>(args: Parameters<DiagnosisModelClient['chatJSON']>[0]): Promise<T> => {
      call = args;
      return {
        symptom: 'Checkout payment submit returns a server error',
        roleLens: 'Sales/CSM language was translated into a backend checkout reproduction.',
        evidence: ['Confirmed report and network log both point at /api/checkout.'],
        hypotheses: [
          {
            title: 'Payment token serialization mismatch',
            confidence: 0.83,
            reproductionPlan: 'Submit checkout with a saved card token in a sandbox.',
            expectedFailure: 'POST /api/checkout returns 500 before the fix.',
          },
        ],
      } as T;
    },
  };

  const diagnosis = await diagnoseWithLLM(
    {
      role: 'sales_csm',
      symptomSeed: 'Checkout submit fails after clicking Pay',
      confirmedReport: {
        whereItHappens: 'Checkout payment form',
        actualBehavior: 'Clicking Pay returns 500.',
      },
    },
    client
  );

  assert.equal(call?.system, DIAGNOSIS_SYSTEM_PROMPT);
  assert.equal(call?.model, 'test/diagnosis-model');
  assert.match(call?.user ?? '', /Confirmed report:/);
  assert.match(call?.user ?? '', /Checkout payment form/);
  assert.equal(diagnosis.symptom, 'Checkout payment submit returns a server error');
  assert.equal(diagnosis.hypotheses[0]?.id, 'hyp_payment_token_serialization_mismatch');
  assert.equal(diagnosis.hypotheses[0]?.confidence, 0.83);
});

test('diagnosis falls back when no model key is available', async () => {
  const client: DiagnosisModelClient = {
    hasModelKey: () => false,
    chatJSON: async () => {
      throw new Error('chatJSON should not be called without a model key');
    },
  };

  const diagnosis = await diagnoseWithLLM(
    {
      role: 'sales_csm',
      symptomSeed: 'Report export failed with 504 after clicking Export CSV',
      confirmedReport: {
        actualBehavior: 'Request to /api/test-fixtures/export failed (504).',
      },
    },
    client
  );

  assert.equal(diagnosis.symptom, 'Report export hangs on large datasets');
  assert.equal(diagnosis.hypotheses[0]?.title, 'Unbounded report query');
});

test('prompt builders include schema and grounding context', () => {
  const reportPrompt = buildReportDraftUserPrompt({
    role: 'engineer',
    repoUrl: 'https://github.com/yxshrk/electron',
    commandText: 'export API times out',
    segment,
  });
  const diagnosisPrompt = buildDiagnosisUserPrompt({
    role: 'engineer',
    symptomSeed: 'export API times out',
    confirmedReport: { actualBehavior: 'Export API returns 504' },
  });

  assert.match(reportPrompt, /Return JSON with exactly these fields/);
  assert.match(reportPrompt, /Evidence summaries:/);
  assert.match(diagnosisPrompt, /roleLensInstruction:/);
  assert.match(diagnosisPrompt, /hypotheses/);
});

test('report prompt caps context without removing the JSON schema', () => {
  const prompt = buildReportDraftUserPrompt({
    role: 'sales_csm',
    repoUrl: 'https://github.com/yxshrk/electron',
    commandText: 'checkout fails',
    notes: 'x'.repeat(1000),
    segment,
    maxPromptChars: 220,
  });

  assert.match(prompt, /\[truncated\]/);
  assert.match(prompt, /Return JSON with exactly these fields/);
  assert.match(prompt, /agentPromptPreview/);
});

/**
 * Restores an environment variable after a test.
 *
 * @param key Environment variable name.
 * @param value Original value captured before the test.
 * @returns Nothing.
 * @sideEffects Mutates process.env for test isolation.
 */
function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
