import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import { BOARD_DUE_JOINS_SQL, BOARD_MANUAL_UPDATED_AT_SQL, buildBoardDueDateSql } from './board-due.sql.js';
import { resolveBoardDueDate, type BoardDueSource } from './resolve-board-due-date.js';

// This task's explicitly authorized local test database; no production connection is accepted.
const local = /^postgresql:\/\/[^@]+@(?:localhost|127\.0\.0\.1):5432\/borrow_return(?:\?|$)/.test(process.env.DATABASE_URL ?? '');
const date = (day: string | null) => day ? new Date(`${day}T00:00:00.000Z`) : null;
const fixtures = [
  { id: 'manual-newer', manual: '2026-11-08', manualAt: '2026-11-04', excel: '2026-11-12', excelAt: '2026-11-03', scaw: '2026-11-30', split: null },
  { id: 'excel-newer', manual: '2026-11-01', manualAt: '2026-11-02', excel: '2026-11-06', excelAt: '2026-11-03', scaw: '2026-11-30', split: null },
  { id: 'no-excel-manual', manual: '2026-11-08', manualAt: '2026-11-04', excel: null, excelAt: '2026-11-03', scaw: '2026-11-30', split: null },
  { id: 'only-scaw', manual: null, manualAt: null, excel: null, excelAt: null, scaw: '2026-11-10', split: null },
  { id: 'split', manual: '2026-11-15', manualAt: '2026-11-05', excel: '2026-11-20', excelAt: '2026-11-06', scaw: '2026-11-30', split: '2026-11-04' },
  { id: 'tie-excel', manual: '2026-11-13', manualAt: '2026-11-03', excel: '2026-11-09', excelAt: '2026-11-03', scaw: null, split: null },
  { id: 'none', manual: null, manualAt: null, excel: null, excelAt: null, scaw: null, split: null }
];

describe('manual due SQL reuse', () => {
  it('keeps authority subqueries in one non-flattened lateral and references its column', () => {
    expect(BOARD_DUE_JOINS_SQL.sql.match(/FROM "ProductionScheduleSeibanProcessingDueDate"/g)).toHaveLength(1);
    expect(BOARD_DUE_JOINS_SQL.sql).toContain('OFFSET 0');
    expect(BOARD_MANUAL_UPDATED_AT_SQL.sql).toBe('"manual_due_at"."manualUpdatedAt"');
    const excel = buildBoardDueDateSql().sql;
    expect(excel).not.toContain('SELECT');
    expect(excel.indexOf('"excel_due"."partsCompleteDate" IS NULL')).toBeLessThan(excel.indexOf('"manual_due_at"'));
    const scaw = buildBoardDueDateSql('scaw').sql;
    expect(scaw).toContain('COALESCE("n"."dueDate", "supplement"."plannedEndDate")');
    expect(scaw).not.toContain('manual_due_at');
  });
});

describe.skipIf(!local)('resolved board due SQL on PostgreSQL', () => {
  for (const source of ['excel', 'scaw'] as BoardDueSource[]) {
    it(`${source}: SQL sorting and values match the pure resolver, including split`, async () => {
      const values = fixtures.map((f) => Prisma.sql`(${f.id}, ${date(f.manual)}::date, ${date(f.manualAt)}::timestamp,
        ${date(f.excel)}::date, ${date(f.excelAt)}::timestamp, ${date(f.scaw)}::date, ${date(f.split)}::date)`);
      const expression = buildBoardDueDateSql(source, Prisma.sql`"fixture"."split"`);
      const rows = await prisma.$queryRaw<Array<{ id: string; due: Date | null }>>(Prisma.sql`
        WITH "fixture"("id", "manual", "manualAt", "excel", "excelAt", "scaw", "split") AS (VALUES ${Prisma.join(values)}),
        "ProductionScheduleDScheduleMinutes" AS (
          SELECT ${PRODUCTION_SCHEDULE_DASHBOARD_ID} AS "csvDashboardId", 'D-TEST-' || "id" AS "fseiban",
            "excel" AS "partsCompleteDate", "excelAt" AS "excelChangedAt" FROM "fixture"
        ),
        "ProductionScheduleSeibanDueDate" AS (
          SELECT ${PRODUCTION_SCHEDULE_DASHBOARD_ID} AS "csvDashboardId", 'D-TEST-' || "id" AS "fseiban",
            "manual" AS "dueDate", "manualAt" AS "updatedAt" FROM "fixture"
        )
        SELECT "fixture"."id", ${expression} AS "due" FROM "fixture"
        CROSS JOIN LATERAL (SELECT jsonb_build_object('FSEIBAN', 'D-TEST-' || "fixture"."id", 'FHINCD', 'D-TEST') AS "rowData") AS "CsvDashboardRow"
        CROSS JOIN LATERAL (SELECT "fixture"."manual" AS "dueDate", NULL::text AS "processingType") AS "n"
        ${BOARD_DUE_JOINS_SQL}
        CROSS JOIN LATERAL (SELECT "fixture"."scaw" AS "plannedEndDate") AS "supplement"
        ORDER BY ${expression} ASC NULLS LAST, "fixture"."id"
      `);
      const expected = fixtures.map((f) => ({ id: f.id, due: resolveBoardDueDate({ source, itemOverride: null,
        splitDueDate: f.split, manualDueDate: f.manual, manualUpdatedAt: date(f.manualAt), excelDueDate: f.excel,
        excelChangedAt: date(f.excelAt), scawPlannedEndDate: f.scaw }) }))
        .sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.id.localeCompare(b.id));
      expect(rows.map((row) => ({ id: row.id, due: row.due?.toISOString().slice(0, 10) ?? null }))).toEqual(expected);
    });
  }
});
