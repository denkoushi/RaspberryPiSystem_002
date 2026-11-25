import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const readMigration = (name: string) =>
  readFileSync(new URL(`../../../prisma/migrations/${name}/migration.sql`, import.meta.url), 'utf8');

it('holds write locks on the rows and all board key tables before taking the rehash snapshot', () => {
  const sql = readMigration('20261125110000_keep_all_manufacturing_orders_rehash');
  const prefix = sql.slice(sql.indexOf('BEGIN;'), sql.indexOf('CREATE TEMP TABLE'));
  expect(prefix).toMatch(/^BEGIN;\s+SET LOCAL lock_timeout = '30s';\s+LOCK TABLE "CsvDashboardRow" IN SHARE ROW EXCLUSIVE MODE;/);
  for (const name of ['Override', 'Arrival', 'FirstProcessArrival']) {
    expect(prefix).toContain(`"ProductionScheduleGrindingPlanningBoard${name}"`);
  }
});

it('gives both piece backfills the constant dashboard predicate of the partial index', () => {
  const sql = readMigration('20261125120000_sessaku_piece_sets_by_product_no');
  expect(sql.match(/AND r\."csvDashboardId" = '3f2f6b0e-6a1e-4c0b-9d0b-1a4f3f0d2a01'/g)).toHaveLength(2);
});
