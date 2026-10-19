import { describe, expect, it } from 'vitest';

import { buildStartDateLevelingQueryWindowWhereSql } from '../start-date-leveling-query-window.policy.js';

describe('buildStartDateLevelingQueryWindowWhereSql', () => {
  it('日付欠損行は期間条件で落とさず、両方ある行だけ交差判定する', () => {
    const sql = buildStartDateLevelingQueryWindowWhereSql({
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
});
