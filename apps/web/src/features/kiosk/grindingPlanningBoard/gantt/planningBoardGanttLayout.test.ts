import { describe, expect, it } from 'vitest';

import { planningBoardAutoOrder, planningBoardOrderMetrics } from './planningBoardAutoOrder';
import { buildPlanningBoardGanttLayout, dateToDay, forwardPlanningBoardPredecessors, planningBoardPartKey, shiftedDueDate, workingPeriods } from './planningBoardGanttLayout';

import type { GanttLayoutOptions } from './planningBoardGanttLayout';
import type { GrindingPlanningBoardItem } from '@raspi-system/shared-types';

const item = (overrides: Partial<GrindingPlanningBoardItem> = {}): GrindingPlanningBoardItem => ({
  itemId: 'a', kind: 'row', itemRevision: 'r1', version: 1, sourceRowId: 'a',
  fseiban: '26-1001', fhincd: 'P1', fhinmei: '部品', machineName: '機種', productNo: '1', processOrder: '10',
  originalResourceCd: '305', effectiveResourceCd: null, originalDueDate: '2026-10-14', effectiveDueDate: null,
  originalRank: null, alternateRank: null, plannedQuantity: 1, requiredMinutes: 480, lslhSurface: false, requiredMinutesKnown: true,
  isCompleted: false, progress: { completed: 0, total: 1, quantityKnown: true }, ...overrides
});
const layout = (items: GrindingPlanningBoardItem[], options: Partial<GanttLayoutOptions> = {}) => buildPlanningBoardGanttLayout({
  items, allocation: 'alternate', view: 'seiban', seibanOrder: ['26-1001'], resources: ['305'], dailyHoursByResource: {}, today: '2026-10-14', scale: 14, ...options
});
const bars = (value: ReturnType<typeof layout>) => value.groups.flatMap((group) => group.rows.flatMap((row) => row.bars));

describe('planningBoardGanttLayout', () => {
  it('retains ordinary process dependencies without allocating piece groups', () => {
    const values = [item(), item({ itemId: 'b', processOrder: '20' }), item({ itemId: 'c', processOrder: '30' })];
    const { predecessors, processCounts } = forwardPlanningBoardPredecessors(values);
    expect([...predecessors]).toEqual([['b', ['a']], ['c', ['b']]]);
    expect(processCounts).toBeUndefined();
    for (const mode of ['backward', 'forward'] as const) {
      const result = layout(values, { mode, now: new Date('2026-10-14T08:00:00+09:00') });
      expect(result.groups[0]?.rows[0]?.detail).toBe('P1 · 3工程');
      expect(bars(result).map((bar) => bar.item.itemId)).toEqual(['a', 'b', 'c']);
    }
  });

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
  it.each([false, true])('compacts arrived work and restores an arrival at its ranked slot (saved order %s)', (explicit) => {
    const items = ['first', 'pending', 'last'].map((id, index) => item({
      itemId: id, fhincd: id, alternateRank: explicit ? 3 - index : index + 1,
      requiredMinutes: 30, arrived: id !== 'pending'
    }));
    const options: Partial<GanttLayoutOptions> = { arrivalFilterEnabled: true,
      ...(explicit ? { laneOrder: { '305': ['first', 'pending', 'last'] } } : {}) };
    const result = forward(items, options);
    const [first, last] = bars(result);
    expect(bars(result).map((bar) => bar.item.itemId)).toEqual(['first', 'last']);
    expect(last!.start).toBe(first!.end);
    expect(result.forwardQueue?.map((bar) => bar.item.itemId)).toEqual(['first', 'pending', 'last']);
    expect(result.forwardQueue?.[0]).toBe(first);
    expect(result.forwardQueue?.[2]).toBe(last);
    expect(result.forwardQueue?.[1]).toMatchObject({ arrivalPending: true, start: null, end: null });
    expect(result.forwardQueue?.[1]?.segments).toBeUndefined();

    const arrived = forward(items.map((value) => ({ ...value, arrived: true })), options);
    const [arrivedFirst, newlyArrived, shiftedLast] = bars(arrived);
    expect(bars(arrived).map((bar) => bar.item.itemId)).toEqual(['first', 'pending', 'last']);
    expect(newlyArrived!.start).toBe(arrivedFirst!.end);
    expect(shiftedLast!.start).toBe(newlyArrived!.end);
    expect(shiftedLast!.start! - last!.start!).toBeCloseTo(30 / 1440);

    const unfiltered = forward(items, { ...options, arrivalFilterEnabled: false });
    expect(unfiltered).toEqual(forward(items, { ...options, arrivalFilterEnabled: undefined }));
    expect(bars(unfiltered).map(({ start, end, segments }) => ({ start, end, segments })))
      .toEqual(bars(arrived).map(({ start, end, segments }) => ({ start, end, segments })));
    expect(unfiltered.forwardQueue).toBeUndefined();
    const unfilteredBars = bars(unfiltered);
    expect(unfilteredBars).toHaveLength(3);
    expect(unfilteredBars[1]!.start).toBe(unfilteredBars[0]!.end);
    expect(unfilteredBars[2]!.start).toBe(unfilteredBars[1]!.end);
  });
  it('excludes pending predecessors across resources and pending fillers from scheduling', () => {
    const result = forward([
      item({ itemId: 'pre', originalResourceCd: '584', requiredMinutes: 120 }),
      item({ itemId: 'pendingPre', processOrder: '20', originalResourceCd: '999', arrived: false }),
      item({ itemId: 'waiting', processOrder: '30', alternateRank: 1, requiredMinutes: 30 }),
      item({ itemId: 'pendingFiller', fhincd: 'P2', alternateRank: 2, arrived: false }),
      item({ itemId: 'ready', fhincd: 'P3', alternateRank: 3, requiredMinutes: 30 })
    ], { arrivalFilterEnabled: true, dailyHoursByResource: { '305': 24, '584': 24 } });
    const byId = new Map(bars(result).map((bar) => [bar.item.itemId, bar]));
    expect([...byId.keys()]).not.toContain('pendingPre');
    expect([...byId.keys()]).not.toContain('pendingFiller');
    expect(byId.get('ready')!.start).toBeCloseTo(today + 13 / 24);
    expect(byId.get('waiting')!.start).toBe(byId.get('pre')!.end);
    expect(byId.get('waiting')!.waitFrom).toBe(byId.get('ready')!.end);
    expect(result.forwardQueue?.filter((bar) => bar.resource === '305').map((bar) => bar.item.itemId))
      .toEqual(['ready', 'pendingFiller', 'waiting']);
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
  it('pauses for the 10:00, 12:10 and 14:50 breaks in 8H and 10H', () => {
    const at = (hour: string, minutes: number, hours: 8 | 10) => bars(forward([item({ requiredMinutes: minutes })],
      { dailyHoursByResource: { '305': hours }, now: new Date(`2026-10-14T${hour}+09:00`) }))[0]!;
    const minutes = (time: number) => Math.round((time - today) * 1440);
    const morning = at('10:00:00', 30, 8);
    expect(morning.segments!.map((segment) => [minutes(segment.start), minutes(segment.end)])).toEqual([[610, 640]]);
    expect(at('10:05:00', 10, 8).start).toBeCloseTo(today + 610 / 1440);
    expect(at('12:00:00', 20, 10).segments!.map((segment) => [minutes(segment.start), minutes(segment.end)])).toEqual([[720, 730], [770, 780]]);
    expect(at('14:45:00', 10, 8).end).toBeCloseTo(today + 905 / 1440);
  });
  it('ends 8H at 17:00 and 10H at 19:00 after one hour of breaks; 24H has none', () => {
    expect(workingPeriods(8).at(-1)!.end).toBeCloseTo(17 / 24);
    expect(workingPeriods(10).at(-1)!.end).toBeCloseTo(19 / 24);
    expect(workingPeriods(8).reduce((sum, period) => sum + period.end - period.start, 0)).toBeCloseTo(8 / 24);
    expect(workingPeriods(24)).toEqual([{ start: 0, end: 1 }]);
  });
  it.each([8, 10] as const)('keeps the %iH shift window and uses break minutes when running through', (hours) => {
    const periods = workingPeriods(hours);
    expect(periods.map(({ start, end }) => [Math.round(start * 1440), Math.round(end * 1440)]))
      .toEqual([[480, 600], [610, 730], [770, 890], [900, (hours + 9) * 60]]);
    expect(periods.reduce((sum, period) => sum + period.end - period.start, 0)).toBeCloseTo(hours / 24);
    expect(workingPeriods(hours, false)).toEqual([{ start: 8 / 24, end: (hours + 9) / 24 }]);
    const bar = bars(forward([item({ requiredMinutes: 20 })], { dailyHoursByResource: { '305': hours },
      runsThroughBreaks: new Set(['305']), now: new Date('2026-10-14T12:00:00+09:00') }))[0]!;
    expect(bar.segments).toHaveLength(1);
    expect(bar.start).toBeCloseTo(today + 720 / 1440);
    expect(bar.end).toBeCloseTo(today + 740 / 1440);
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
  it.each([false, true])('fills waiting lanes in queue order without changing ranks (explicit order %s)', (explicit) => {
    const items = [
      item({ itemId: 'pre', originalResourceCd: '584', requiredMinutes: 120 }),
      item({ itemId: 'waiting', processOrder: '20', alternateRank: 1, requiredMinutes: 30 }),
      item({ itemId: 'ready1', fhincd: 'P2', alternateRank: 2, requiredMinutes: 30 }),
      item({ itemId: 'ready2', fhincd: 'P3', alternateRank: 3, requiredMinutes: 150 })
    ];
    const options = { dailyHoursByResource: { '305': 24 as const, '584': 24 as const },
      ...(explicit ? { laneOrder: { '305': ['waiting', 'ready1', 'ready2'], '584': ['pre'] } } : {}) };
    const result = forward(items, options);
    const byId = new Map(bars(result).map((bar) => [bar.item.itemId, bar]));
    expect(byId.get('ready1')!.start).toBeCloseTo(today + 13 / 24);
    expect(byId.get('ready2')!.start).toBe(byId.get('ready1')!.end);
    expect(byId.get('waiting')!.start).toBe(byId.get('ready2')!.end);
    expect(byId.get('waiting')!.start!).toBeGreaterThanOrEqual(byId.get('pre')!.end!);
    expect(byId.get('waiting')!.waitFrom).toBeUndefined();
    expect(planningBoardOrderMetrics(result).waitMinutes).toBe(0);
    expect(items.map((item) => item.alternateRank)).toEqual([null, 1, 2, 3]);
    expect(forward(items, options)).toEqual(result);
  });
  it('waits after filling a shorter job and does not pull a later unready job forward', () => {
    const result = forward([
      item({ itemId: 'pre', originalResourceCd: '584', requiredMinutes: 120 }),
      item({ itemId: 'waiting', processOrder: '20', alternateRank: 1, requiredMinutes: 30 }),
      item({ itemId: 'unready', processOrder: '30', alternateRank: 2, requiredMinutes: 30 }),
      item({ itemId: 'ready', fhincd: 'P2', alternateRank: 3, requiredMinutes: 30 })
    ], { dailyHoursByResource: { '305': 24, '584': 24 } });
    const byId = new Map(bars(result).map((bar) => [bar.item.itemId, bar]));
    const waiting = byId.get('waiting')!;
    expect(waiting.start).toBe(byId.get('pre')!.end);
    expect(waiting.waitFrom).toBe(byId.get('ready')!.end);
    expect(byId.get('unready')!.start).toBe(waiting.end);
    expect(result.groups.find((group) => group.resource === '305')!.rows[0]!.connectors)
      .toEqual([{ start: waiting.waitFrom, end: waiting.start }]);
    expect(planningBoardOrderMetrics(result).waitMinutes).toBe(90);
  });
  it('fills with a later process whose scheduled predecessor has ended at the cursor', () => {
    const result = forward([
      item({ itemId: 'preReady', fhincd: 'P2', originalResourceCd: '584', alternateRank: 1, requiredMinutes: 30 }),
      item({ itemId: 'preWaiting', originalResourceCd: '584', alternateRank: 2, requiredMinutes: 120 }),
      item({ itemId: 'first', fhincd: 'P3', alternateRank: 1, requiredMinutes: 30 }),
      item({ itemId: 'waiting', processOrder: '20', alternateRank: 2, requiredMinutes: 30 }),
      item({ itemId: 'ready', fhincd: 'P2', processOrder: '20', alternateRank: 3, requiredMinutes: 30 })
    ], { dailyHoursByResource: { '305': 24, '584': 24 } });
    const byId = new Map(bars(result).map((bar) => [bar.item.itemId, bar]));
    expect(byId.get('ready')!.start).toBe(byId.get('preReady')!.end);
    expect(byId.get('ready')!.start).toBe(byId.get('first')!.end);
    expect(byId.get('waiting')!.start).toBe(byId.get('preWaiting')!.end);
    expect(byId.get('waiting')!.waitFrom).toBe(byId.get('ready')!.end);
  });
  it('keeps the wait when every later job also awaits its predecessor', () => {
    const result = forward([
      item({ itemId: 'pre', originalResourceCd: '584', requiredMinutes: 120 }),
      item({ itemId: 'waiting', processOrder: '20', alternateRank: 1, requiredMinutes: 30 }),
      item({ itemId: 'later', processOrder: '30', alternateRank: 2, requiredMinutes: 30 })
    ], { dailyHoursByResource: { '305': 24, '584': 24 } });
    const byId = new Map(bars(result).map((bar) => [bar.item.itemId, bar]));
    expect(byId.get('waiting')!.start).toBe(byId.get('pre')!.end);
    expect(byId.get('waiting')!.waitFrom).toBeCloseTo(today + 13 / 24);
    expect(byId.get('later')!.start).toBe(byId.get('waiting')!.end);
    expect(planningBoardOrderMetrics(result).waitMinutes).toBe(120);
  });
  it.each(['10', ''])('keeps ordinary rows with the same or empty process order (%s) serial across resources', (processOrder) => {
    const result = forward([
      item({ itemId: 'b', processOrder, originalResourceCd: '584', alternateRank: 1, requiredMinutes: 30 }),
      item({ itemId: 'a', processOrder, alternateRank: 2, requiredMinutes: 60 })
    ]);
    const a = bars(result).find((bar) => bar.item.itemId === 'a')!;
    const b = bars(result).find((bar) => bar.item.itemId === 'b')!;
    expect(b.start).toBe(a.end);
    expect(b.waitFrom).toBeDefined();
  });
  it('retains explicit proposal slots when their heads cycle with process precedence', () => {
    const result = forward([
      item({ itemId: 'b', processOrder: '20', alternateRank: 1, requiredMinutes: 30 }),
      item({ itemId: 'a', alternateRank: 2, requiredMinutes: 60 })
    ], { laneOrder: { '305': ['b', 'a'] } });
    expect(bars(result).map((bar) => bar.item.itemId)).toEqual(['b', 'a']);
    expect(bars(result)[0]!.start).toBeCloseTo(today + 13 / 24);
    expect(bars(result)[1]!.start).toBe(bars(result)[0]!.end);
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


describe('piece gantt scheduling', () => {
  const pieces = () => [item({ itemId: 'piece:a', kind: 'piece', parentItemId: 'parent', piecePosition: 1, quantity: 2, parentPlannedQuantity: 5, requiredMinutes: 40, alternateRank: 1 }),
    item({ itemId: 'piece:b', kind: 'piece', parentItemId: 'parent', piecePosition: 2, quantity: 3, parentPlannedQuantity: 5, requiredMinutes: 60, alternateRank: 3 })];
  const opts = (items: GrindingPlanningBoardItem[]): GanttLayoutOptions => ({ items, allocation: 'alternate', view: 'resource',
    seibanOrder: ['26-1001'], resources: ['305', '584', '999'], dailyHoursByResource: { '305': 24, '584': 24, '999': 24 },
    today: '2026-10-14', now: new Date('2026-10-14T08:00:00+09:00'), scale: 1 });
  it('orders sibling chains by position before UUID, retaining the UUID fallback for missing positions', () => {
    const values = [item({ itemId: 'piece:a', kind: 'piece', parentItemId: 'parent', piecePosition: 2 }),
      item({ itemId: 'piece:z', kind: 'piece', parentItemId: 'parent', piecePosition: 1 }),
      item({ itemId: 'piece:c', kind: 'piece', parentItemId: 'parent' }),
      item({ itemId: 'piece:b', kind: 'piece', parentItemId: 'parent' }),
      item({ itemId: 'next', processOrder: '20' })];
    const expected = ['piece:z', 'piece:a', 'piece:b', 'piece:c', 'next'];
    const { parts, predecessors } = forwardPlanningBoardPredecessors(values);
    expect([...parts.values()][0]!.map((item) => item.itemId)).toEqual(expected);
    expect(predecessors.get('next')).toEqual(expected.slice(0, -1));
    const backward = buildPlanningBoardGanttLayout({ ...opts(values), view: 'seiban' });
    expect(backward.groups[0]!.rows[0]!.bars.map((bar) => bar.item.itemId)).toEqual(expected);
  });
  it('keeps 40+60 minutes with B between the pieces and uses the same times in proposal and drawing', () => {
    const values = [...pieces(), item({ itemId: 'B', fhincd: 'other', requiredMinutes: 20, alternateRank: 2 })];
    const input = opts(values);
    const order = planningBoardAutoOrder(input, new Set(values.map((item) => item.itemId)));
    const result = bars(buildPlanningBoardGanttLayout({ ...input, mode: 'forward', laneOrder: order }));
    expect(result.map((bar) => bar.item.itemId)).toEqual(['piece:a', 'B', 'piece:b']);
    expect((result[2]!.end! - result[0]!.start!) * 1440).toBeCloseTo(120);
    for (const bar of result) expect(bar.segments!.reduce((sum, segment) => sum + (segment.end - segment.start) * 1440, 0)).toBeCloseTo(bar.item.requiredMinutes!);
  });
  it('does not count overlapping sibling pieces as process conflicts or extra processes', () => {
    const values = pieces();
    values[1] = { ...values[1]!, effectiveResourceCd: '584' };
    const result = buildPlanningBoardGanttLayout({ ...opts(values), view: 'seiban' });
    expect(result.overlapCount).toBe(0);
    expect(bars(result).every((bar) => !bar.flagged && bar.overlaps.length === 0)).toBe(true);
    expect(result.groups[0]!.rows[0]!.detail).toBe('P1 · 1工程');
    expect(result.groups[0]!.rows[0]!.connectors).toEqual([]);
    const resource = buildPlanningBoardGanttLayout(opts(values));
    expect(resource.overlapCount).toBe(0);
    expect(bars(resource).every((bar) => !bar.flagged)).toBe(true);
    const next = item({ itemId: 'next', processOrder: '20', requiredMinutes: 10 });
    const conflicted = buildPlanningBoardGanttLayout({ ...opts([...values, next]), view: 'seiban' });
    expect(conflicted.overlapCount).toBe(1);
    expect(bars(conflicted).every((bar) => bar.flagged)).toBe(true);
    expect(conflicted.groups[0]!.rows[0]!.detail).toBe('P1 · 2工程');
  });
  it.each(['backward', 'forward'] as const)('shares the process count with seiban details for mixed chains in %s mode', (mode) => {
    const values = [...pieces(), item({ itemId: 'next', processOrder: '20', requiredMinutes: 10 }),
      item({ itemId: 'independent', fhincd: 'P2' }), item({ itemId: 'independent-next', fhincd: 'P2', processOrder: '20' })];
    const result = buildPlanningBoardGanttLayout({ ...opts(values), mode, view: 'seiban' });
    expect(result.groups[0]?.rows.map((row) => row.detail)).toEqual(['P1 · 2工程', 'P2 · 2工程']);
    const { predecessors, processCounts } = forwardPlanningBoardPredecessors(values);
    expect(predecessors.get('next')).toEqual(['piece:a', 'piece:b']);
    expect(processCounts?.get(planningBoardPartKey(values[0]!))).toBe(2);
    expect(predecessors.get('independent-next')).toEqual(['independent']);
  });
  it('runs sibling pieces on separate resources and waits for every earlier unfinished item', () => {
    const values = pieces(); values[1] = { ...values[1]!, effectiveResourceCd: '584' };
    values.push(item({ itemId: 'next', processOrder: '20', effectiveResourceCd: '999', requiredMinutes: 10 }));
    const input = opts(values);
    const result = bars(buildPlanningBoardGanttLayout({ ...input, mode: 'forward' }));
    const a = result.find((bar) => bar.item.itemId === 'piece:a')!;
    const b = result.find((bar) => bar.item.itemId === 'piece:b')!;
    expect(a.start).toBe(b.start);
    expect(result.find((bar) => bar.item.itemId === 'next')!.start).toBe(b.end);
    expect(planningBoardAutoOrder(input, new Set())).toEqual({ '305': ['piece:a'], '584': ['piece:b'], '999': ['next'] });
    const done = values.map((value) => value.itemId === 'piece:b' ? { ...value, isCompleted: true } : value);
    const compact = bars(buildPlanningBoardGanttLayout({ ...opts(done), mode: 'forward' }));
    expect(compact.find((bar) => bar.item.itemId === 'next')!.start).toBe(a.end);
  });
  it.each(['backward', 'forward'] as const)('retains fractional minutes and treats zero as known in %s mode', (mode) => {
    const values = pieces().map((value, index) => ({ ...value, requiredMinutes: index ? 2 / 3 : 1 / 3 }));
    const result = bars(buildPlanningBoardGanttLayout({ ...opts(values), mode }));
    expect(result.reduce((sum, bar) => sum + (bar.end! - bar.start!) * 1440, 0)).toBeCloseTo(1);
    const zero = bars(buildPlanningBoardGanttLayout({ ...opts([item({ kind: 'piece', parentItemId: 'parent', requiredMinutes: 0 })]), mode }))[0]!;
    expect(zero.unknown).toBe(false); expect(zero.start).toBe(zero.end);
  });
  it('resolves reversed saved resource ranks without bypassing unfinished predecessors', () => {
    const values = [...pieces(), item({ itemId: 'next', processOrder: '20', alternateRank: 0, requiredMinutes: 10 })];
    const result = bars(buildPlanningBoardGanttLayout({ ...opts(values), mode: 'forward' }));
    const next = result.find((bar) => bar.item.itemId === 'next')!;
    expect(next.start).toBe(Math.max(...result.filter((bar) => bar.item.kind === 'piece').map((bar) => bar.end!)));
  });
});

describe('unit piece timing and setup', () => {
  const unit = (id: string, fhincd = 'P1', extra: Partial<GrindingPlanningBoardItem> = {}) => item({
    itemId: id, fseiban: `S-${id}`, kind: 'piece', parentItemId: `parent-${id}`, piecePosition: 1,
    fhincd, requiredMinutes: 999, unitRequiredMinutes: 60, setupMinutes: 999,
    ops: [{ opNo: 20, minutes: 30 }, { opNo: 10, minutes: 10 }], completedOpNos: [10], ...extra
  });
  const resourceMinutes = { ownSourceResourceCds: ['305'], values: ['P1', 'P2'].map(fhincd => ({ resourceCd: '305', fhincd, perUnitMinutes: 60, setupMinutes: fhincd === 'P1' ? 15 : 30 })) };
  const options = { mode: 'forward' as const, view: 'resource' as const, now: new Date('2026-10-14T08:00:00+09:00'), resourceMinutes };
  const minutes = (spans: { start: number; end: number }[] = []) => spans.reduce((sum, span) => sum + (span.end - span.start) * 1440, 0);
  it.each(['forward', 'backward'] as const)('uses unit time, sorted proportional ops and completed appearance metadata in %s', (mode) => {
    const bar = bars(layout([unit('a')], { ...options, mode }))[0]!;
    const factor = mode === 'backward' ? 3 : 1; // Backward scales a working day of 8H into a calendar day.
    expect(minutes(bar.setupSegments) / factor).toBeCloseTo(15);
    expect(bar.opSegments?.map(op => [op.opNo, op.completed])).toEqual([[10, true], [20, false]]);
    expect(minutes(bar.opSegments?.filter(op => op.opNo === 10)) / factor).toBeCloseTo(15);
    expect(minutes(bar.opSegments?.filter(op => op.opNo === 20)) / factor).toBeCloseTo(45);
    expect(bar.setupSegments![0]!.start).toBeCloseTo(bar.start!);
    expect(bar.setupSegments![0]!.end).toBeCloseTo(bar.opSegments![0]!.start);
  });
  it('adds setup only at product changes in the actual lane order, including a return to a product', () => {
    const values = [unit('a'), unit('b', 'P1', { processOrder: '20' }), unit('c', 'P2'), unit('d')];
    const result = bars(layout(values, { ...options, laneOrder: { '305': ['a', 'b', 'c', 'd'] } }));
    expect(result.map(bar => bar.item.itemId)).toEqual(['a', 'b', 'c', 'd']);
    expect(result.map(bar => Math.round(minutes(bar.setupSegments)))).toEqual([15, 0, 30, 15]);
    expect(result[1]!.start).toBeCloseTo(result[0]!.end!);
  });
  it('uses actual reordered lane products rather than original item order', () => {
    const result = bars(layout([unit('a'), unit('b'), unit('c', 'P2')], { ...options, laneOrder: { '305': ['c', 'b', 'a'] } }));
    expect(result.map(bar => [bar.item.itemId, Math.round(minutes(bar.setupSegments))])).toEqual([['c', 30], ['b', 15], ['a', 0]]);
  });
  it.each([undefined, { ownSourceResourceCds: [], values: resourceMinutes.values }, { ownSourceResourceCds: ['305'], values: [] }])('omits setup without an own product value', resourceMinutes => {
    const bar = bars(layout([unit('a')], { ...options, resourceMinutes }))[0]!;
    expect(bar.setupSegments).toEqual([]);
    expect(minutes(bar.segments)).toBeCloseTo(60);
  });
  it('keeps legacy rows and pieces without unit time unchanged even with ops and product values', () => {
    for (const value of [item(), unit('a', 'P1', { unitRequiredMinutes: null, requiredMinutes: 480 })]) {
      const bar = bars(layout([value], options))[0]!;
      expect(minutes(bar.segments)).toBeCloseTo(480);
      expect(bar.setupSegments).toBeUndefined(); expect(bar.opSegments).toBeUndefined();
    }
  });
  it('splits operation and setup spans around working breaks without losing their minutes', () => {
    const bar = bars(layout([unit('a')], { ...options, now: new Date('2026-10-14T09:55:00+09:00') }))[0]!;
    expect(bar.setupSegments).toHaveLength(2);
    expect(minutes(bar.setupSegments)).toBeCloseTo(15);
    expect(minutes(bar.opSegments)).toBeCloseTo(60);
    expect(bar.setupSegments![0]!.end).toBeCloseTo(dateToDay('2026-10-14') + 10 / 24);
    expect(bar.setupSegments![1]!.start).toBeCloseTo(dateToDay('2026-10-14') + (10 * 60 + 10) / 1440);
  });
});
