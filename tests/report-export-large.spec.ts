import assert from 'node:assert/strict';
import test from 'node:test';
import { createLargeReportFixture, expectedCsvLineCount } from '../lib/demo/report-fixture';
import { exportReportCsv, exportReportCsvBatched } from '../lib/reports/export';

test('default seeded export path reproduces the large report failure', () => {
  const rows = createLargeReportFixture();

  assert.throws(
    () => exportReportCsv(rows),
    /Report export exceeded the synchronous row budget/
  );
});

test('known batched fix exports the large report fixture', () => {
  const rows = createLargeReportFixture();
  const csv = exportReportCsvBatched(rows);

  assert.equal(csv.split('\n').length, expectedCsvLineCount(rows));
  assert.match(csv, /report_row_00001/);
  assert.match(csv, /report_row_12000/);
});
