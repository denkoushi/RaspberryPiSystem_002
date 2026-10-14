import { describe, expect, it } from 'vitest';

import { buildPlanningBoardGanttLayout, dateToDay, planningBoardPartKey, shiftedDueDate } from './planningBoardGanttLayout';

import type { GanttLayoutOptions } from './planningBoardGanttLayout';
import type { GrindingPlanningBoardItem } from '@raspi-system/shared-types';

const item = (overrides: Partial<GrindingPlanningBoardItem> = {}): GrindingPlanningBoardItem => ({
  itemId: 'a', kind: 'row', itemRevision: 'r1', version: 1, sourceRowId: 'a',
  fseiban: '26-1001', fhincd: 'P1', fhinmei: '部品', machineName: '機種', productNo: '1', processOrder: '10',
  originalResourceCd: '305', effectiveResourceCd: null, originalDueDate: '2026-10-14', effectiveDueDate: null,
  originalRank: null, alternateRank: null, plannedQuantity: 1, requiredMinutes: 480, requiredMinutesKnown: true,
  isCompleted: false, progress: { completed: 0, total: 1, quantityKnown: true }, ...overrides
});
const layout = (items: GrindingPlanningBoardItem[], options: Partial<GanttLayoutOptions> = {}) => buildPlanningBoardGanttLayout({
  items, allocation: 'alternate', view: 'seiban', seibanOrder: ['26-1001'], resources: ['305'], dailyHoursByResource: {}, today: '2026-10-14', scale: 14, ...options
});
const bars = (value: ReturnType<typeof layout>) => value.groups.flatMap((group) => group.rows.flatMap((row) => row.bars));

describe('planningBoardGanttLayout', () => {
  it.each([8, 10, 24] as const)('%i時間で所要時間を暦日に換算し納期日の終わりへ固定する', (hours) => {
    const bar = bars(layout([item()], { dailyHoursByResource: { '305': hours } }))[0]!;
    expect(bar.end).toBe(dateToDay('2026-10-15'));
    expect(bar.end! - bar.start!).toBeCloseTo(480 / (hours * 60));
  });
  it('別割当の納期・資源を使い、元割当では元の値を使う', () => {
    const values = [item({ effectiveDueDate: '2026-10-16', effectiveResourceCd: '584' })];
    expect(bars(layout(values))[0]).toMatchObject({ due: '2026-10-16', resource: '584' });
    expect(bars(layout(values, { allocation: 'original' }))[0]).toMatchObject({ due: '2026-10-14', resource: '305' });
  });
  it.each([{ requiredMinutesKnown: false }, { requiredMinutes: 0 }, { requiredMinutes: null }])('所要不明は固定幅マーカー、納期なしは棒なし', (overrides) => {
    const result = bars(layout([item(overrides), item({ itemId: 'b', originalDueDate: null })]));
    expect(result.find((bar) => bar.item.itemId === 'a')).toMatchObject({ unknown: true, end: dateToDay('2026-10-15') });
    expect(result.find((bar) => bar.item.itemId === 'b')).toMatchObject({ start: null, end: null });
  });
  it('工順20は100より先で、同日終了は重なり1組', () => {
    const result = layout([item({ itemId: 'b', processOrder: '100' }), item({ processOrder: '20' })]);
    expect(bars(result).map((bar) => bar.item.itemId)).toEqual(['a', 'b']);
    expect(result.overlapCount).toBe(1);
    expect(bars(result).every((bar) => bar.flagged && bar.overlaps.length === 1)).toBe(true);
  });
  it('工順が同じならitemId順、所要不明同士も同日終了を検出する', () => {
    const result = layout([item({ itemId: 'b', requiredMinutes: 0 }), item({ requiredMinutes: 0 })]);
    expect(bars(result).map((bar) => bar.item.itemId)).toEqual(['a', 'b']);
    expect(result.overlapCount).toBe(1);
  });
  it('隣接する工程は重ならず、空き期間にだけ接続線が付く（土日も数える）', () => {
    const rows = [item({ originalDueDate: '2026-10-16' }), item({ itemId: 'b', processOrder: '20', originalDueDate: '2026-10-17' })];
    expect(layout(rows).overlapCount).toBe(0);
    expect(layout(rows).groups[0]!.rows[0]!.connectors).toEqual([]);
    const result = layout([rows[0]!, { ...rows[1]!, originalDueDate: '2026-10-18' }]);
    expect(result.groups[0]!.rows[0]!.connectors).toEqual([{ start: dateToDay('2026-10-17'), end: dateToDay('2026-10-18') }]);
  });
  it('資源をまたぐ工程でも両行に警告を付け、見えている工程だけを数える', () => {
    const values = [item(), item({ itemId: 'b', processOrder: '20', originalResourceCd: '584' })];
    const result = layout(values, { view: 'resource', resources: ['584', '305'] });
    expect(result.groups.map((group) => group.key)).toEqual(['584', '305']);
    expect(result.overlapCount).toBe(1);
    expect(bars(result).every((bar) => bar.flagged)).toBe(true);
    expect(layout(values.slice(0, 1)).overlapCount).toBe(0);
  });
  it('逆転して離れた工程も警告するが、重ならない期間へ斜線を描かない', () => {
    const result = layout([item(), item({ itemId: 'b', processOrder: '20', originalDueDate: '2026-10-10' })]);
    expect(result.overlapCount).toBe(1);
    expect(bars(result).every((bar) => bar.flagged && !bar.overlaps.length)).toBe(true);
  });
  it('部品キーは製番・品番、未採番だけ製品番号を加える', () => {
    expect(planningBoardPartKey(item())).toBe(planningBoardPartKey(item({ productNo: '2' })));
    expect(planningBoardPartKey(item())).not.toBe(planningBoardPartKey(item({ fhincd: 'P2' })));
    expect(planningBoardPartKey(item())).not.toBe(planningBoardPartKey(item({ fseiban: '26-1002' })));
    expect(planningBoardPartKey(item({ fseiban: ' ******** ', productNo: '1' }))).not.toBe(planningBoardPartKey(item({ fseiban: '********', productNo: '2' })));
    expect(layout([item({ fseiban: '********' }), item({ itemId: 'b', fseiban: '********', productNo: '2' })]).overlapCount).toBe(0);
  });
  it('完了・超過の色と400日上限、今日の範囲を保証する', () => {
    const result = layout([item({ originalDueDate: '2020-01-01' }), item({ itemId: 'b', originalDueDate: '2030-01-01', isCompleted: true })]);
    expect(bars(result).map((bar) => bar.tone)).toEqual(['late', 'completed']);
    expect(result.end - result.start).toBeLessThanOrEqual(400);
    expect(result.start).toBeLessThan(result.today);
    expect(result.end).toBeGreaterThan(result.today + 14);
  });
  it('納期を早める操作は今日で止まり、超過済みの棒は左移動で日付が変わらない', () => {
    expect(shiftedDueDate('2026-10-20', -20, '2026-10-14')).toBe('2026-10-14');
    expect(shiftedDueDate('2026-10-10', -2, '2026-10-14')).toBe('2026-10-10');
    expect(shiftedDueDate('2026-10-20', 2, '2026-10-14')).toBe('2026-10-22');
  });
});
