import assert from 'node:assert/strict';
import test from 'node:test';
import { createLargeReportFixture, expectedCsvLineCount } from '../app/test-fixtures/reports/report-fixture';
import { exportReportCsv, exportReportCsvBatched } from '../app/test-fixtures/reports/export';

test('default export path handles the large report fixture without exceeding the row budget', () => {
  const rows = createLargeReportFixture();
  const csv = exportReportCsv(rows);

  assert.equal(csv.split('\n').length, expectedCsvLineCount(rows));
});

test('known batched fix exports the large report fixture', () => {
  const rows = createLargeReportFixture();
  const csv = exportReportCsvBatched(rows);

  assert.equal(csv.split('\n').length, expectedCsvLineCount(rows));
  assert.match(csv, /report_row_00001/);
  assert.match(csv, /report_row_12000/);
});
