import { useRef, useState } from 'react';

import { resolveGrindingPlanningBoardResource, sortGrindingPlanningBoardItems } from '../sortGrindingPlanningBoardItems';
import { usePlanningBoardPageGantt } from '../usePlanningBoardPageGantt';
import { usePlanningBoardWriteQueue } from '../usePlanningBoardWriteQueue';

import type { productionFixture } from './fixture';
import type { ResourceOrderHistory, ResourceOrderSnapshot } from '../planningBoardPageModel';
import type { PlanningBoardWrite } from '../usePlanningBoardWriteQueue';

type PageOptions = Parameters<typeof usePlanningBoardPageGantt>[0];
const noop = () => {};
const emptyGroups = new Map();

/** Page-owned state and callbacks, with only network I/O replaced by the caller. */
export function useDueSortHarness(fixture: ReturnType<typeof productionFixture>, save: PageOptions['updateResourceOrderBulkAsync'],
  refresh: () => Promise<unknown>, observeWrite: (write: PlanningBoardWrite) => PlanningBoardWrite = (write) => write) {
  const queue = usePlanningBoardWriteQueue({ scope: 'perf:grinding', items: fixture.items, order: fixture.seibans,
    sourceRevision: 'source-0', refresh, onStart: noop, onSuccess: noop, onError: noop });
  const currentItemsRef = useRef(queue.items);
  currentItemsRef.current = queue.items;
  const [history, setHistory] = useState<ResourceOrderHistory[]>([]);
  const historyId = useRef(0);
  const page = usePlanningBoardPageGantt({
    focusedFseiban: null, sortedItemsBySeiban: emptyGroups, view: 'resource', visibleItems: queue.items,
    nowMs: fixture.options.now!.getTime(), ganttEnabled: true, allocation: 'alternate', category: 'grinding',
    data: undefined, registeredFseibans: fixture.seibans, bulkReady: true, rankMutationReady: true, writeBlocked: false,
    writeQueue: queue, orderPreview: null, resourceOrderHistory: history, historyScope: 'perf:grinding', currentItemsRef,
    hasPendingSeiban: queue.hasPendingSeiban, enqueueWrite: (write) => queue.enqueue(observeWrite(write)),
    updateResourceOrderBulkAsync: save, setColorBySeiban: noop, setFocusedFseiban: noop, setOpenFseibans: noop,
    setFocusedSeiban: noop, setScanFocusKey: noop, setScanNotice: noop, scopeReady: true, pinMode: false,
    canMoveResource: () => true,
    snapshotResourceOrder: (resourceCd) => ({ resourceCd,
      itemIds: sortGrindingPlanningBoardItems(currentItemsRef.current.filter((item) => !item.isCompleted &&
        (resolveGrindingPlanningBoardResource(item, 'alternate') ?? '未設定') === resourceCd), fixture.seibans, 'resource', 'alternate').map((item) => item.itemId) }),
    notify: noop, resourceOrderHistoryId: historyId, enqueueOverrides: () => false, setResourceOrderHistory: setHistory,
    rememberResourceOrder: (id, snapshot: ResourceOrderSnapshot) => setHistory((previous) => {
      const existing = previous.find((entry) => entry.id === id);
      return existing ? previous.map((entry) => entry === existing ? { ...entry, orders: [...entry.orders, snapshot] } : entry)
        : [...previous, { id, scope: 'perf:grinding', orders: [snapshot] }].slice(-10);
    }),
    setPinMode: noop, setOrderPreview: noop, sourceRevision: 'source-0', rankConflict: false, orderConflict: false,
    updatePinsAsync: async () => { throw new Error('Pins are outside this harness'); }
  });
  return { page, queue, history };
}
