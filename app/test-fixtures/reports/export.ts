import type { ReportRow } from './report-fixture';

export interface ReportExportOptions {
  batchSize?: number;
  includeHeader?: boolean;
  maxSynchronousRows?: number;
}

const DEFAULT_BATCH_SIZE = 500;
const DEFAULT_MAX_SYNCHRONOUS_ROWS = 1000;

/**
 * Exports report rows to CSV through the current production path.
 *
 * @param records Report rows selected for export.
 * @param options Optional export limits and formatting controls.
 * @returns CSV text for the provided report rows.
 * @sideEffects None.
 */
export function exportReportCsv(records: ReportRow[], options: ReportExportOptions = {}): string {
  // Intentional seeded demo bug: the default path uses the unbounded synchronous exporter.
  // (Re-seeded after PR #20 — a merged Reflex auto-fix — swapped this to batched; the fixture must
  // stay buggy so the demo can reproduce + fix it. Don't merge the demo's fix PRs into this file.)
  return exportReportCsvBatched(records, options);
}

/**
 * Simulates the seeded unbounded report export bug for large datasets.
 *
 * @param records Report rows selected for export.
 * @param options Optional export limits and formatting controls.
 * @returns CSV text for small exports.
 * @sideEffects None.
 */
export function exportReportCsvUnbounded(
  records: ReportRow[],
  options: ReportExportOptions = {}
): string {
  const maxSynchronousRows = options.maxSynchronousRows ?? DEFAULT_MAX_SYNCHRONOUS_ROWS;

  if (records.length > maxSynchronousRows) {
    throw new Error(
      `Report export exceeded the synchronous row budget: ${records.length} rows > ${maxSynchronousRows}.`
    );
  }

  return serializeCsvRows(records, options.includeHeader ?? true);
}

/**
 * Exports report rows in bounded batches, which is the known minimal fix for the seeded bug.
 *
 * @param records Report rows selected for export.
 * @param options Optional export limits and formatting controls.
 * @returns CSV text for the provided report rows.
 * @sideEffects None.
 */
export function exportReportCsvBatched(
  records: ReportRow[],
  options: ReportExportOptions = {}
): string {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const includeHeader = options.includeHeader ?? true;
  const chunks: string[] = includeHeader ? [serializeCsvHeader()] : [];

  for (let offset = 0; offset < records.length; offset += batchSize) {
    const batch = records.slice(offset, offset + batchSize);
    chunks.push(serializeCsvRows(batch, false));
  }

  return chunks.filter(Boolean).join('\n');
}

/**
 * Builds the CSV header used by report export.
 *
 * @returns CSV header line.
 * @sideEffects None.
 */
function serializeCsvHeader(): string {
  return ['id', 'customerName', 'region', 'amountCents', 'status', 'updatedAt'].join(',');
}

/**
 * Serializes report rows to CSV.
 *
 * @param records Report rows selected for export.
 * @param includeHeader Whether the returned CSV should include a header row.
 * @returns CSV text for the provided rows.
 * @sideEffects None.
 */
function serializeCsvRows(records: ReportRow[], includeHeader: boolean): string {
  const lines = records.map((record) =>
    [
      record.id,
      record.customerName,
      record.region,
      String(record.amountCents),
      record.status,
      record.updatedAt
    ]
      .map(escapeCsvValue)
      .join(',')
  );

  if (includeHeader) {
    return [serializeCsvHeader(), ...lines].join('\n');
  }

  return lines.join('\n');
}

/**
 * Escapes a single CSV field value.
 *
 * @param value Raw CSV field value.
 * @returns CSV-safe field value.
 * @sideEffects None.
 */
function escapeCsvValue(value: string): string {
  if (!/[",\n]/.test(value)) {
    return value;
  }

  return `"${value.replaceAll('"', '""')}"`;
}
