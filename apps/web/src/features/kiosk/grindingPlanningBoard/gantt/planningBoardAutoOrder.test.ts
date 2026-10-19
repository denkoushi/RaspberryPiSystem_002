import { describe, expect, it } from 'vitest';

import { sortGrindingPlanningBoardItems } from '../sortGrindingPlanningBoardItems';

import { planningBoardAutoOrder, planningBoardLaneOrder, planningBoardOrderMetrics } from './planningBoardAutoOrder';
import { buildForwardPlanningBoardGanttLayout } from './planningBoardGanttLayout';

import type { GanttLayoutOptions } from './planningBoardGanttLayout';
import type { GrindingPlanningBoardItem } from '@raspi-system/shared-types';

const item = (id: string, rank: number, due: string | null, extra: Partial<GrindingPlanningBoardItem> = {}): GrindingPlanningBoardItem => ({
  itemId: id, kind: 'row', itemRevision: id, version: 0, sourceRowId: id,
  fseiban: 'S', fhincd: id, fhinmei: id, machineName: null, productNo: '1', processOrder: '10',
  originalResourceCd: '305', effectiveResourceCd: null, originalDueDate: due, effectiveDueDate: null,
  originalRank: null, alternateRank: rank, plannedQuantity: 1, requiredMinutes: 480, requiredMinutesKnown: true,
  isCompleted: false, progress: { completed: 0, total: 1, quantityKnown: true }, ...extra
});
const options = (items: GrindingPlanningBoardItem[]): GanttLayoutOptions => ({ items, allocation: 'alternate', view: 'resource',
  seibanOrder: ['S'], resources: ['305', '584'], dailyHoursByResource: {}, today: '2026-10-14', scale: 14, now: new Date('2026-10-14T08:00:00+09:00') });
const bars = (value: ReturnType<typeof buildForwardPlanningBoardGanttLayout>) => value.groups.flatMap((group) => group.rows.flatMap((row) => row.bars));

describe('planningBoardAutoOrder', () => {
  it('keeps special-due bands ahead of complete saved ranks', () => {
    const input = options([item('normal', 1, '2026-10-14'), item('special', 2, '2026-10-20', {
      specialDue: { kind: 'today', expiresAt: '2026-10-14T10:00:00Z' }
    })]);
    expect(planningBoardLaneOrder(input)).toEqual({ '305': ['special', 'normal'] });
    expect(bars(buildForwardPlanningBoardGanttLayout(input)).map((bar) => bar.item.itemId)).toEqual(['special', 'normal']);
  });
  it('round-trips saved ranks with special due dates, pinned slots and predecessors', () => {
    const input = options([
      item('urgent', 3, '2026-10-14'),
      item('today', 5, '2026-10-20', { specialDue: { kind: 'today', expiresAt: '2026-10-14T10:00:00Z' } }),
      item('morning', 6, '2026-10-22', { fhincd: 'part', processOrder: '20',
        specialDue: { kind: 'overnight', expiresAt: '2026-10-14T00:00:00Z' } }),
      item('same-expiry', 7, '2026-10-14', { specialDue: { kind: 'today', expiresAt: '2026-10-14T10:00:00Z' } }),
      item('pin', 1, '2026-10-25'), item('later', 2, '2026-10-23'),
      item('predecessor', 1, '2026-10-24', { fhincd: 'part', originalResourceCd: '584' })
    ]);
    const proposal = planningBoardAutoOrder(input, new Set(['pin']));
    expect(proposal).toEqual({ '305': ['morning', 'today', 'same-expiry', 'pin', 'urgent', 'later'], '584': ['predecessor'] });
    for (const lane of Object.values(proposal)) {
      const saved = lane.map((id, index) => ({ ...input.items.find((entry) => entry.itemId === id)!, alternateRank: index + 1 }));
      expect(sortGrindingPlanningBoardItems(saved, input.seibanOrder, 'resource', 'alternate').map((entry) => entry.itemId)).toEqual(lane);
    }
    const scheduled = bars(buildForwardPlanningBoardGanttLayout({ ...input, laneOrder: proposal }));
    expect(scheduled.find((bar) => bar.item.itemId === 'morning')!.start!).toBeGreaterThanOrEqual(
      scheduled.find((bar) => bar.item.itemId === 'predecessor')!.end!);
  });
  it('reduces late items, reproduces the proposed order and is deterministic', () => {
    const input = options([item('later', 1, '2026-10-17'), item('urgent', 2, '2026-10-14')]);
    const proposed = planningBoardAutoOrder(input, new Set());
    expect(proposed).toEqual({ '305': ['urgent', 'later'] });
    expect(planningBoardAutoOrder(input, new Set())).toEqual(proposed);
    const before = buildForwardPlanningBoardGanttLayout(input);
    const after = buildForwardPlanningBoardGanttLayout({ ...input, laneOrder: proposed });
    expect(planningBoardOrderMetrics(before).lateCount).toBe(1);
    expect(planningBoardOrderMetrics(after).lateCount).toBe(0);
    expect(bars(after).map((bar) => bar.item.itemId)).toEqual(['urgent', 'later']);
  });
  it('keeps pinned indices, omits completed work and puts no due date last', () => {
    const input = options([item('none', 1, null), item('pin', 2, '2026-10-20'), item('urgent', 3, '2026-10-14'), item('done', 4, null, { isCompleted: true })]);
    expect(planningBoardAutoOrder(input, new Set(['pin']))).toEqual({ '305': ['urgent', 'pin', 'none'] });
  });
  it('waits for predecessors across resources and reuses breaks and working windows', () => {
    const input = options([item('first', 1, '2026-10-20', { fhincd: 'part' }),
      item('next', 1, '2026-10-14', { fhincd: 'part', processOrder: '20', originalResourceCd: '584' }),
      item('ready', 2, '2026-10-15', { originalResourceCd: '584', requiredMinutes: 60 })]);
    const order = planningBoardAutoOrder(input, new Set());
    expect(order).toEqual({ '305': ['first'], '584': ['ready', 'next'] });
    const layout = buildForwardPlanningBoardGanttLayout({ ...input, laneOrder: order });
    const all = bars(layout);
    const first = all.find((bar) => bar.item.itemId === 'first')!;
    const next = all.find((bar) => bar.item.itemId === 'next')!;
    expect(next.start!).toBeGreaterThanOrEqual(first.end!);
    expect(planningBoardOrderMetrics(layout).waitMinutes).toBe(1380);
  });
  it('preserves current order for ties and reserves pins even when they deadlock precedence', () => {
    const input = options([item('successor', 1, null, { fhincd: 'part', processOrder: '20' }),
      item('first', 2, null, { fhincd: 'part' }), item('other', 3, null)]);
    const order = planningBoardAutoOrder(input, new Set(['successor']));
    expect(order).toEqual({ '305': ['successor', 'first', 'other'] });
    expect(bars(buildForwardPlanningBoardGanttLayout({ ...input, laneOrder: order })).map((bar) => bar.item.itemId)).toEqual(order['305']);
    expect(planningBoardAutoOrder(options([item('b', 1, null), item('a', 2, null)]), new Set())).toEqual({ '305': ['b', 'a'] });
  });
});
