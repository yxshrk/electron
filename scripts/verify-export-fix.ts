import { createLargeReportFixture, expectedCsvLineCount } from '../lib/demo/report-fixture';
import { exportReportCsv } from '../lib/reports/export';

/**
 * Verifies that the default report export path handles the large fixture.
 *
 * @returns Process exit code for the verification command.
 * @sideEffects Writes verification output to stderr/stdout.
 */
function main(): number {
  const rows = createLargeReportFixture();
  const csv = exportReportCsv(rows);
  const lineCount = csv.split('\n').length;

  if (lineCount !== expectedCsvLineCount(rows)) {
    console.error(
      `Expected ${expectedCsvLineCount(rows)} CSV lines after the fix, but got ${lineCount}.`
    );
    return 1;
  }

  console.log('PASS report export completes for a large dataset');
  return 0;
}

process.exitCode = main();
