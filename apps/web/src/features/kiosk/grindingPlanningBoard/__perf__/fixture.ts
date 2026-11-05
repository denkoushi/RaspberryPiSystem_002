import type { GanttLayoutOptions } from '../gantt/planningBoardGanttLayout';
import type { GrindingPlanningBoardItem } from '@raspi-system/shared-types';

export function productionFixture(count = 1500, resourceCount = 20) {
  const seibans = Array.from({ length: 80 }, (_, i) => `26-${1000 + i}`);
  const resources = Array.from({ length: resourceCount }, (_, i) => `${300 + i}`);
  const items: GrindingPlanningBoardItem[] = Array.from({ length: count }, (_, i) => {
    const part = Math.floor(i / 3);
    return {
      itemId: `item-${String(i).padStart(4, '0')}`, kind: i % 17 === 0 ? 'split' : 'row',
      itemRevision: `revision-${i}`, version: 1, sourceRowId: `row-${i}`,
      fseiban: seibans[part % seibans.length]!, fhincd: `part-${part}`, fhinmei: `部品${part}`,
      machineName: '合成機種', productNo: `${part}`, processOrder: `${(i % 3 + 1) * 10}`,
      originalResourceCd: resources[(part * 7 + i % 3) % resources.length]!, effectiveResourceCd: null,
      originalDueDate: `2026-11-${String(6 + (part * 13 + i % 3) % 23).padStart(2, '0')}`,
      effectiveDueDate: i % 11 === 0 ? '2026-11-09' : null,
      originalRank: i + 1, alternateRank: i + 1, plannedQuantity: i % 17 === 0 ? 2 : 5,
      requiredMinutes: 30 + i % 6 * 45, requiredMinutesKnown: true, isCompleted: false,
      progress: { completed: 0, total: 5, quantityKnown: true },
      specialDue: i % 29 === 0 ? { kind: i % 2 ? 'overnight' : 'today',
        expiresAt: i % 2 ? '2026-11-06T08:00:00+09:00' : '2026-11-05T17:00:00+09:00' } : null
    };
  });
  const options: GanttLayoutOptions = { items, resources, seibanOrder: seibans, allocation: 'alternate',
    view: 'resource', category: 'grinding', dailyHoursByResource: {}, today: '2026-11-05',
    now: new Date('2026-11-05T08:00:00+09:00'), scale: 1, mode: 'forward' };
  return { items, seibans, resources, options };
}
