import { useEffect, useRef, useState } from 'react';

import { createKioskGrindingPlanningBoardTestBar, mutateKioskGrindingPlanningBoardTestBar } from '../../../api/domains/production-schedule/grinding-planning-board';

import { usePlanningBoardOffline } from './offline/PlanningBoardOfflineProvider';
import { comparePlanningBoardBarOrder, resolveGrindingPlanningBoardResource, resolvePlanningBoardOrderBand, sortGrindingPlanningBoardItems } from './sortGrindingPlanningBoardItems';


import type { ResourceOrderHistory } from './planningBoardPageModel';
import type { PlanningBoardWriteResult, usePlanningBoardWriteQueue } from './usePlanningBoardWriteQueue';
import type { GrindingPlanningBoardBar, GrindingPlanningBoardItem, GrindingPlanningBoardResponse, GrindingPlanningBoardTestBar, GrindingPlanningBoardTestBarCreateRequest, GrindingPlanningBoardTestBarMutationResponse } from '@raspi-system/shared-types';

export const isPendingPlanningTestBar = (item: GrindingPlanningBoardBar) => item.itemId.startsWith('test:pending:');

const EMPTY: GrindingPlanningBoardTestBar[] = [];
export type PlanningBoardTestBarControls = {
  bars: readonly GrindingPlanningBoardTestBar[];
  nextSequence: number;
  selectedId: string | null;
  selectedBar: GrindingPlanningBoardTestBar | null;
  select: (item: GrindingPlanningBoardBar, selected: boolean) => void;
  create: (resource: string, minutes: number, after?: GrindingPlanningBoardBar) => Promise<boolean>;
  remove: (item: GrindingPlanningBoardTestBar) => void;
  complete: (item: GrindingPlanningBoardTestBar, intent: 'complete' | 'incomplete') => void;
  accept: (result: PlanningBoardWriteResult) => void;
  undo: (entry: ResourceOrderHistory, done: () => void) => boolean;
  reorder?: (item: GrindingPlanningBoardBar, target: GrindingPlanningBoardBar, placement: 'before' | 'after') => void;
  disabled: boolean;
};
export function usePlanningBoardTestBars({ data, items = data?.items ?? [], enqueue, remember, disabled }: {
  data: GrindingPlanningBoardResponse | undefined;
  items?: GrindingPlanningBoardItem[];
  enqueue: ReturnType<typeof usePlanningBoardWriteQueue>['enqueue'];
  remember: (item: GrindingPlanningBoardTestBar, action: 'delete' | 'restore', restoreAfterItemId?: string | null) => void;
  disabled: boolean;
}): PlanningBoardTestBarControls {
  const { enabled: offlineEnabled, refreshRead } = usePlanningBoardOffline();
  const [overlay, setOverlay] = useState<{ siteKey: string; stale: Set<string>; revision: string; bars: GrindingPlanningBoardTestBar[]; next: number } | null>(null);
  const [pending, setPending] = useState<Array<{ id: number; siteKey: string; apply: (bars: GrindingPlanningBoardTestBar[]) => GrindingPlanningBoardTestBar[]; next?: number }>>([]);
  useEffect(() => { setPending([]); }, [data?.siteKey]);
  const pendingId = useRef(0);
  const clearPending = (id: number) => setPending((writes) => writes.filter((write) => write.id !== id));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const activeOverlay = overlay && data && overlay.siteKey === data.siteKey && (overlay.stale.has(data.sourceRevision) || overlay.revision === data.sourceRevision) ? overlay : null;
  const latest = useRef({ data, activeOverlay }); latest.current = { data, activeOverlay };
  const pendingHere = pending.filter((write) => write.siteKey === data?.siteKey);
  const bars = pendingHere.reduce((bars, write) => write.apply(bars), activeOverlay?.bars ?? data?.testBars ?? EMPTY);
  const nextSequence = Math.max(activeOverlay?.next ?? data?.nextTestBarSequence ?? 1, ...pendingHere.map((write) => write.next ?? 1));
  const accept = (result: PlanningBoardWriteResult) => {
    if (!result.testBars) return;
    if (offlineEnabled) void refreshRead('load').catch(() => undefined);
    setOverlay((previous) => ({ siteKey: latest.current.data?.siteKey ?? '', stale: new Set([...previous?.stale ?? [], latest.current.data?.sourceRevision ?? '', previous?.revision ?? '']),
      revision: result.sourceRevision ?? '', bars: result.testBars!, next: result.nextTestBarSequence ?? previous?.next ?? data?.nextTestBarSequence ?? 1 }));
  };
  const mutate = (item: GrindingPlanningBoardTestBar, action: 'delete' | 'restore' | 'complete' | 'incomplete', onSaved?: (result: GrindingPlanningBoardTestBarMutationResponse) => void, restoreAfterItemId?: string | null) => {
    if (disabled || isPendingPlanningTestBar(item)) return false;
    const id = ++pendingId.current;
    setPending((writes) => [...writes, { id, siteKey: data?.siteKey ?? '', apply: (bars) => action === 'delete'
      ? bars.filter((bar) => bar.itemId !== item.itemId)
      : action === 'restore' ? [...bars.filter((bar) => bar.itemId !== item.itemId), { ...item, deletedAt: null }]
      : bars.map((bar) => bar.itemId === item.itemId ? { ...bar, isCompleted: action === 'complete', completedAt: action === 'complete' ? new Date().toISOString() : null } : bar) }]);
    let saved: GrindingPlanningBoardTestBarMutationResponse | undefined;
    const queued = enqueue({ label: 'テスト加工', itemIds: [item.itemId], seibans: [], order: true, apply: (display) => display,
      save: async (context) => {
        const current = (latest.current.activeOverlay?.bars ?? latest.current.data?.testBars)?.find((candidate) => candidate.itemId === item.itemId) ?? item;
        saved = await mutateKioskGrindingPlanningBoardTestBar(item.itemId, action, { dueSource: latest.current.data?.dueSource, sourceRevision: context.sourceRevision, expectedVersion: current.version,
          ...(action === 'restore' && restoreAfterItemId !== undefined ? { restoreAfterItemId } : {}) });
        return saved;
      }, onSaved: (result) => { clearPending(id); accept(result); if (saved) onSaved?.(saved); },
      onFailed: () => clearPending(id), onDiscarded: () => clearPending(id)
    });
    if (!queued) clearPending(id);
    return queued;
  };
  return { bars, selectedId, selectedBar: bars.find((item) => item.itemId === selectedId) ?? null,
    nextSequence, disabled,
    select: (item, selected) => { if (!isPendingPlanningTestBar(item)) setSelectedId(item.kind === 'test' && selected ? item.itemId : null); }, accept,
    create: async (resourceCd, minutes, after) => {
      if (disabled || (after && isPendingPlanningTestBar(after))) return false;
      const id = ++pendingId.current;
      const normal = sortGrindingPlanningBoardItems(items.filter((item) => !item.isCompleted && resolveGrindingPlanningBoardResource(item, 'alternate') === resourceCd), data?.seibanOrder ?? [], 'resource', 'alternate');
      const lane: GrindingPlanningBoardBar[] = [...normal, ...bars.filter((bar) => !bar.isCompleted && !bar.deletedAt && bar.resourceCd === resourceCd)];
      if (lane.some((bar) => bar.kind === 'test')) lane.sort(comparePlanningBoardBarOrder);
      const unbanded = lane.filter((bar) => resolvePlanningBoardOrderBand(bar) == null);
      const at = after && resolvePlanningBoardOrderBand(after) == null ? unbanded.findIndex((bar) => bar.itemId === after.itemId) + 1 : 0;
      const temporary: GrindingPlanningBoardTestBar = { kind: 'test', itemId: `test:pending:${id}`, itemRevision: `test:pending:${id}`, version: 0,
        sequence: nextSequence, name: `テスト${nextSequence}`, resourceCd, minutes, alternateRank: at + 1, isCompleted: false, completedAt: null, deletedAt: null };
      unbanded.splice(at, 0, temporary);
      const ranks = new Map(unbanded.map((bar, index) => [bar.itemId, index + 1]));
      setPending((writes) => [...writes, { id, siteKey: data?.siteKey ?? '', next: nextSequence + 1,
        apply: (bars) => [...bars.map((bar) => ranks.has(bar.itemId) ? { ...bar, alternateRank: ranks.get(bar.itemId)! } : bar), temporary] }]);
      let saved: GrindingPlanningBoardTestBarMutationResponse | undefined;
      const queued = enqueue({ label: 'テスト加工', itemIds: after ? [after.itemId] : [], seibans: [], order: true, apply: (display) => ({ ...display, items: display.items.map((item) => ranks.has(item.itemId) ? { ...item, alternateRank: ranks.get(item.itemId)! } : item) }),
        save: async (context) => {
          const current = after?.kind === 'test' ? (latest.current.activeOverlay?.bars ?? latest.current.data?.testBars)?.find((bar) => bar.itemId === after.itemId) ?? after : after ? context.item(after) : undefined;
          const request: GrindingPlanningBoardTestBarCreateRequest = { dueSource: latest.current.data?.dueSource, sourceRevision: context.sourceRevision, resourceCd, minutes,
            ...(current ? { afterItem: { itemId: current.itemId, itemRevision: current.itemRevision, overrideVersion: current.version } } : {}) };
          saved = await createKioskGrindingPlanningBoardTestBar(request); return saved;
        }, onSaved: (result) => { clearPending(id); accept(result); if (saved) { setSelectedId(saved.testBar.itemId); remember(saved.testBar, 'delete'); } },
        onFailed: () => clearPending(id), onDiscarded: () => clearPending(id)
      });
      if (!queued) clearPending(id);
      return queued;
    },
    remove: (item) => {
      const normal = sortGrindingPlanningBoardItems(items.filter((candidate) => !candidate.isCompleted && resolveGrindingPlanningBoardResource(candidate, 'alternate') === item.resourceCd), data?.seibanOrder ?? [], 'resource', 'alternate');
      const lane: GrindingPlanningBoardBar[] = [...normal, ...bars.filter((bar) => !bar.isCompleted && !bar.deletedAt && bar.resourceCd === item.resourceCd)];
      lane.sort(comparePlanningBoardBarOrder);
      const unbanded = lane.filter((bar) => resolvePlanningBoardOrderBand(bar) == null);
      const at = unbanded.findIndex((bar) => bar.itemId === item.itemId);
      const restoreAfterItemId = at < 0 ? undefined : unbanded[at - 1]?.itemId ?? null;
      mutate(item, 'delete', (result) => { remember(result.testBar, 'restore', restoreAfterItemId); setSelectedId(null); });
    },
    complete: (item, intent) => { mutate(item, intent); },
    undo: (entry, done) => {
      if (!entry.testBarUndo) return false;
      return mutate(entry.testBarUndo.item, entry.testBarUndo.action, () => { setSelectedId(entry.testBarUndo!.action === 'restore' ? entry.testBarUndo!.item.itemId : null); done(); }, entry.testBarUndo.restoreAfterItemId);
    }
  };
}
