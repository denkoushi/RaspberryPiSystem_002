import { describe, expect, it } from 'vitest';

import { buildPlanningBoardGanttLayout, dateToDay, planningBoardPartKey, shiftedDueDate, workingPeriods } from './planningBoardGanttLayout';

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
  it.each(['backward', 'forward'] as const)('groups all resources grinding first in %s mode', (mode) => {
    const options = { mode, view: 'resource' as const, resources: ['100', '584', '200', '305'],
      category: 'all' as const, resourceCategories: { '305': 'grinding', '584': 'grinding', '100': 'cutting', '200': 'cutting' } as const };
    const result = layout([item(), item({ itemId: 'b', originalResourceCd: '100' })], options);
    expect(result.groups.map((group) => group.resource)).toEqual(['584', '305', '100', '200']);
    expect(result.groups.map((group) => group.category)).toEqual(['grinding', 'grinding', 'cutting', 'cutting']);
    expect(layout([], { ...options, resourceCategories: undefined }).groups.map((group) => group.resource)).toEqual(options.resources);
    expect(layout([], { ...options, category: 'cutting' }).groups.map((group) => group.resource)).toEqual(options.resources);
  });
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

describe('forward planningBoardGanttLayout', () => {
  const today = dateToDay('2026-10-14');
  const forward = (items: GrindingPlanningBoardItem[], options: Partial<GanttLayoutOptions> = {}) => layout(items, {
    mode: 'forward', view: 'resource', now: new Date('2026-10-14T13:00:00+09:00'), ...options
  });
  it('starts at JST now and follows resource rank back-to-back, with one lane and today as origin', () => {
    const result = forward([item({ itemId: 'b', fhincd: 'P2', alternateRank: 2, requiredMinutes: 30 }), item({ alternateRank: 1, requiredMinutes: 60 })]);
    const [a, b] = bars(result);
    expect(result.start).toBe(today);
    expect(result.groups[0]!.rows).toHaveLength(1);
    expect(a!.item.itemId).toBe('a');
    expect(a!.start).toBeCloseTo(today + 13 / 24);
    expect(a!.end).toBeCloseTo(today + 14 / 24);
    expect(b!.start).toBeCloseTo(a!.end!);
    expect(b!.end).toBeCloseTo(today + 14.5 / 24);
  });
  it.each([8, 24] as const)('splits at the %iH window and resumes the next day', (hours) => {
    const result = bars(forward([item({ requiredMinutes: 120 })], {
      dailyHoursByResource: { '305': hours }, now: new Date(`2026-10-14T${hours === 8 ? '16' : '23'}:00:00+09:00`)
    }))[0]!;
    expect(result.segments).toHaveLength(2);
    expect(result.segments![0]!.end).toBeCloseTo(today + (hours === 8 ? 17 / 24 : 1));
    expect(result.segments![1]!.start).toBeCloseTo(today + 1 + (hours === 8 ? 8 / 24 : 0));
    expect(result.segments![1]!.end - result.segments![1]!.start).toBeCloseTo(1 / 24);
  });
  it.each([['07', 8, 0, 8], ['17', 8, 1, 8], ['18', 10, 0, 18], ['19', 10, 1, 8]] as const)('normalizes %s:00 in %iH', (hour, hours, day, startHour) => {
    const bar = bars(forward([item({ requiredMinutes: 30 })], { dailyHoursByResource: { '305': hours }, now: new Date(`2026-10-14T${hour}:00:00+09:00`) }))[0]!;
    expect(bar.start).toBeCloseTo(today + day + startHour / 24);
  });
  it('pauses for the 10:10, 12:10 and 14:50 breaks in 8H and 10H', () => {
    const at = (hour: string, minutes: number, hours: 8 | 10) => bars(forward([item({ requiredMinutes: minutes })],
      { dailyHoursByResource: { '305': hours }, now: new Date(`2026-10-14T${hour}+09:00`) }))[0]!;
    const minutes = (time: number) => Math.round((time - today) * 1440);
    const morning = at('10:00:00', 30, 8);
    expect(morning.segments!.map((segment) => [minutes(segment.start), minutes(segment.end)])).toEqual([[600, 640]]);
    expect(at('10:15:00', 10, 8).start).toBeCloseTo(today + 620 / 1440);
    expect(minutes(at('12:00:00', 20, 10).end!)).toBe(780);
    expect(at('14:45:00', 10, 8).end).toBeCloseTo(today + 905 / 1440);
  });
  it('ends 8H at 17:00 and 10H at 19:00 after one hour of breaks; 24H has none', () => {
    expect(workingPeriods(8).at(-1)!.end).toBeCloseTo(17 / 24);
    expect(workingPeriods(10).at(-1)!.end).toBeCloseTo(19 / 24);
    expect(workingPeriods(8).reduce((sum, period) => sum + period.end - period.start, 0)).toBeCloseTo(8 / 24);
    expect(workingPeriods(24)).toEqual([{ start: 0, end: 1 }]);
  });
  it('waits for a predecessor on another resource and draws its gap', () => {
    const result = forward([item({ itemId: 'b', processOrder: '20', alternateRank: 1, originalResourceCd: '584', requiredMinutes: 60 }), item({ alternateRank: 2, requiredMinutes: 120 })]);
    const a = bars(result).find((bar) => bar.item.itemId === 'a')!;
    const b = bars(result).find((bar) => bar.item.itemId === 'b')!;
    expect(b.start).toBeCloseTo(a.end!);
    expect(b.waitFrom).toBeCloseTo(today + 13 / 24);
    expect(b.predecessorEnd).toBe(a.end);
    expect(result.groups.find((group) => group.resource === '584')!.rows[0]!.connectors).toEqual([{ start: b.waitFrom, end: b.start }]);
  });
  it('resolves reversed process ranks without repeatedly pushing the schedule forward', () => {
    const result = forward([item({ itemId: 'b', processOrder: '20', alternateRank: 1, requiredMinutes: 30 }), item({ alternateRank: 2, requiredMinutes: 60 })]);
    const a = bars(result).find((bar) => bar.item.itemId === 'a')!;
    const b = bars(result).find((bar) => bar.item.itemId === 'b')!;
    expect(a.start).toBeCloseTo(today + 13 / 24);
    expect(b.start).toBe(a.end);
  });
  it.each([{ requiredMinutesKnown: false }, { requiredMinutes: null }, { requiredMinutes: 0 }])('unknown work occupies zero time including unassigned resources', (unknown) => {
    const [a, b] = bars(forward([item({ ...unknown, originalResourceCd: null }), item({ itemId: 'b', processOrder: '20', requiredMinutes: 60, originalResourceCd: null })]));
    expect(a).toMatchObject({ unknown: true, resource: '未設定', segments: [] });
    expect(a!.start).toBe(a!.end);
    expect(b!.start).toBe(a!.end);
  });
  it('flags planned-end lateness only with a due date and excludes completed work', () => {
    const result = forward([item({ originalDueDate: '2026-10-13' }), item({ itemId: 'b', fhincd: 'P2', originalDueDate: null }), item({ itemId: 'c', isCompleted: true })]);
    expect(bars(result)).toHaveLength(2);
    expect(bars(result).map((bar) => bar.tone)).toEqual(['late', 'planned']);
    expect(result.lateCount).toBe(1);
    expect(forward([item({ isCompleted: true })]).completedOnly).toBe(true);
  });
  it('end exactly at due midnight is on time; seiban rows retain the same computed segments', () => {
    const value = item({ requiredMinutes: 840 });
    const options = { dailyHoursByResource: { '305': 24 as const }, now: new Date('2026-10-14T10:00:00+09:00') };
    const resourceBar = bars(forward([value], options))[0]!;
    const seibanBar = bars(forward([value], { ...options, view: 'seiban' }))[0]!;
    expect(resourceBar.tone).toBe('planned');
    expect(resourceBar.end).toBeCloseTo(today + 1);
    expect(seibanBar.segments).toEqual(resourceBar.segments);
  });
});
