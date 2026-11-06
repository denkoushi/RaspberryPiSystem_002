import { describe, expect, it } from 'vitest';

import { buildBoardDueDateSql } from '../../d-schedule-minutes/board-due.sql.js';
import { buildStartDateLevelingQueryWindowWhereSql } from '../start-date-leveling-query-window.policy.js';

describe('buildStartDateLevelingQueryWindowWhereSql', () => {
  it('日付欠損行は期間条件で落とさず、両方ある行だけ交差判定する', () => {
    const sql = buildStartDateLevelingQueryWindowWhereSql({
      dueSource: 'scaw' as const,
      rangeStart: new Date('2026-05-01T00:00:00.000Z'),
      rangeEndExclusive: new Date('2026-06-01T00:00:00.000Z')
    }).sql.toLowerCase();

    expect(sql).toContain('"supplement"."plannedstartdate" is null');
    expect(sql).toContain('coalesce("n"."duedate", "supplement"."plannedenddate") is null');
    expect(sql).toContain('"supplement"."plannedstartdate" <');
    expect(sql).toContain('>=');
  });

  it('includeOverdueBefore を渡すと納期遅れ行も通し、渡さなければ条件を足さない', () => {
    const range = {
      dueSource: 'scaw' as const,
      rangeStart: new Date('2026-09-01T00:00:00.000Z'),
      rangeEndExclusive: new Date('2026-12-01T00:00:00.000Z')
    };
    const withOverdue = buildStartDateLevelingQueryWindowWhereSql({
      ...range,
      includeOverdueBefore: new Date('2026-09-30T00:00:00.000Z')
    });
    const without = buildStartDateLevelingQueryWindowWhereSql(range);

    expect(withOverdue.sql).toContain('OR COALESCE("n"."dueDate", "supplement"."plannedEndDate") <');
    expect(withOverdue.values).toContainEqual(new Date('2026-09-30T00:00:00.000Z'));
    expect(without.values).toHaveLength(2);
  });

  it.each(['excel', 'scaw'] as const)('uses %s for all three due predicates', (dueSource) => {
    const sql = buildStartDateLevelingQueryWindowWhereSql({
      dueSource, rangeStart: new Date('2026-05-01Z'), rangeEndExclusive: new Date('2026-06-01Z'),
      includeOverdueBefore: new Date('2026-05-10Z')
    }).sql;
    const due = buildBoardDueDateSql(dueSource).sql;
    expect(sql).toContain(due + ' IS NULL');
    expect(sql).toContain(due + ' <');
    expect(sql).toContain(due + ' >=');
  });
});
