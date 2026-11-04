import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { buildQueryWhere } from '../filters.js';
import { buildBoardDueDateExistsSql } from '../../d-schedule-minutes/board-due.sql.js';
import { filterProductionScheduleDisplayRowsByDueDate } from '../../order-split/production-schedule-order-split.service.js';
import type { ProductionScheduleRow } from '../types.js';

const date = new Date('2026-11-12T00:00:00.000Z');
const row = (id: string, fields: Partial<ProductionScheduleRow> = {}): ProductionScheduleRow => ({
  id, seibanJoinKey: id, occurredAt: date, updatedAt: date, rowData: {}, processingOrder: null,
  globalRank: null, actualPerPieceMinutes: null, note: null, processingType: null, dueDate: null,
  plannedQuantity: null, plannedStartDate: null, plannedEndDate: null, customerName: null, ...fields
});

describe('hasDueDateOnly', () => {
  it('uses resolved board due by default and retains manual-only SCAW filtering', () => {
    const params = {
      textConditions: [], resourceConditions: [], resourceCategoryCondition: Prisma.empty,
      machineNameCondition: Prisma.empty, hasNoteOnly: false, hasDueDateOnly: true
    };
    const excel = buildQueryWhere(params);
    expect(excel.sql).toContain(buildBoardDueDateExistsSql().sql);
    expect(excel.sql).toContain('"excel_due"."partsCompleteDate"');
    expect(buildQueryWhere({ ...params, dueSource: 'excel' }).sql).toBe(excel.sql);
    const scaw = buildQueryWhere({ ...params, dueSource: 'scaw' }).sql;
    expect(scaw).not.toContain('ProductionScheduleDScheduleMinutes');
    expect(scaw).toContain('"dueDate" IS NOT NULL');
    expect(buildQueryWhere({ ...params, hasDueDateOnly: false }).sql).not.toContain('partsCompleteDate');
  });

  it('keeps Excel-only parents, inherited split dues, explicit split dues, and manual dues', () => {
    const rows = [
      row('excel', { excelDueDate: date }),
      row('inherited-split', { isSplit: true, boardDueDate: date }),
      row('explicit-split', { isSplit: true, dueDate: date, boardDueDate: date }),
      row('manual', { dueDate: date }),
      row('scaw-fallback', { plannedEndDate: date }),
      row('none')
    ];
    expect(filterProductionScheduleDisplayRowsByDueDate(rows, true).map((r) => r.id))
      .toEqual(['excel', 'inherited-split', 'explicit-split', 'manual', 'scaw-fallback']);
    expect(filterProductionScheduleDisplayRowsByDueDate(rows, true, 'scaw').map((r) => r.id))
      .toEqual(['explicit-split', 'manual']);
    expect(filterProductionScheduleDisplayRowsByDueDate(rows, false)).toBe(rows);
  });
});
