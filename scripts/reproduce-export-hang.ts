import { createLargeReportFixture } from '../app/test-fixtures/reports/report-fixture';
import { exportReportCsv } from '../app/test-fixtures/reports/export';

/**
 * Runs the deterministic failing repro for the seeded export-hang bug.
 *
 * @returns Process exit code for the repro command.
 * @sideEffects Writes repro output to stderr/stdout.
 */
function main(): number {
  const rows = createLargeReportFixture();

  try {
    exportReportCsv(rows);
    console.error('FAIL report export completes for a large dataset');
    console.error('Expected export to exceed the synchronous row budget, but it completed.');
    return 1;
  } catch (error) {
    console.error('FAIL report export completes for a large dataset');
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

process.exitCode = main();
