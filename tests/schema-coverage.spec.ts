import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { expectedSchemaTables } from '../lib/dashboard/read-model';

test('MVP migration creates every expected Reflex table', () => {
  const migration = readFileSync('migrations/20260606185627_create-reflex-schema.sql', 'utf8');

  for (const tableName of expectedSchemaTables()) {
    assert.match(
      migration,
      new RegExp(`create table ${tableName} \\(`),
      `missing create table statement for ${tableName}`
    );
  }
});
