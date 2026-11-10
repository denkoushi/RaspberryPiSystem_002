import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { buildQueryWhere } from '../filters.js';
import { buildBoardDueDateExistsSql } from '../../d-schedule-minutes/board-due.sql.js';

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

  it('filters parent dates only without reading legacy quantity or date records', () => {
    const sql = buildQueryWhere({ textConditions: [], resourceConditions: [],
      resourceCategoryCondition: Prisma.empty, machineNameCondition: Prisma.empty,
      hasNoteOnly: false, hasDueDateOnly: true }).sql;
    expect(sql).not.toContain('parentCsvDashboardRowId');
    expect(sql).toContain('ProductionScheduleDScheduleMinutes');
  });
});
