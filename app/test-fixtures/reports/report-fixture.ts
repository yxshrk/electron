export interface ReportRow {
  id: string;
  customerName: string;
  region: string;
  amountCents: number;
  status: 'open' | 'closed' | 'at_risk';
  updatedAt: string;
}

const REGIONS = ['na', 'emea', 'apac', 'latam'] as const;
const STATUSES: Array<ReportRow['status']> = ['open', 'closed', 'at_risk'];

/**
 * Creates a deterministic large report fixture for export-hang reproduction.
 *
 * @param rowCount Number of rows to generate.
 * @returns Stable report rows with predictable IDs and values.
 * @sideEffects None.
 */
export function createLargeReportFixture(rowCount = 12000): ReportRow[] {
  return Array.from({ length: rowCount }, (_, index) => {
    const oneBasedIndex = index + 1;

    return {
      id: `report_row_${String(oneBasedIndex).padStart(5, '0')}`,
      customerName: `Customer ${String(oneBasedIndex).padStart(5, '0')}`,
      region: REGIONS[index % REGIONS.length],
      amountCents: 10000 + index * 37,
      status: STATUSES[index % STATUSES.length],
      updatedAt: new Date(Date.UTC(2026, 5, 6, 12, index % 60, 0)).toISOString()
    };
  });
}

/**
 * Calculates the expected number of CSV lines for a report export.
 *
 * @param rows Report rows included in the export.
 * @returns Header line plus one line for each report row.
 * @sideEffects None.
 */
export function expectedCsvLineCount(rows: ReportRow[]): number {
  return rows.length + 1;
}
