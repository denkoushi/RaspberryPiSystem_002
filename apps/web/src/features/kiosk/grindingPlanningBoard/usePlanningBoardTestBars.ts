import { useRef, useState } from 'react';

import { createKioskGrindingPlanningBoardTestBar, mutateKioskGrindingPlanningBoardTestBar } from '../../../api/domains/production-schedule/grinding-planning-board';

import { usePlanningBoardOffline } from './offline/PlanningBoardOfflineProvider';

import type { ResourceOrderHistory } from './planningBoardPageModel';
import type { PlanningBoardWriteResult, usePlanningBoardWriteQueue } from './usePlanningBoardWriteQueue';
import type { GrindingPlanningBoardBar, GrindingPlanningBoardResponse, GrindingPlanningBoardTestBar, GrindingPlanningBoardTestBarCreateRequest, GrindingPlanningBoardTestBarMutationResponse } from '@raspi-system/shared-types';

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
export function usePlanningBoardTestBars({ data, enqueue, remember, disabled }: {
  data: GrindingPlanningBoardResponse | undefined;
  enqueue: ReturnType<typeof usePlanningBoardWriteQueue>['enqueue'];
  remember: (item: GrindingPlanningBoardTestBar, action: 'delete' | 'restore') => void;
  disabled: boolean;
}): PlanningBoardTestBarControls {
  const { enabled: offlineEnabled, refreshRead } = usePlanningBoardOffline();
  const [overlay, setOverlay] = useState<{ siteKey: string; stale: Set<string>; revision: string; bars: GrindingPlanningBoardTestBar[]; next: number } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const latest = useRef({ data, overlay }); latest.current = { data, overlay };
  const activeOverlay = overlay && data && overlay.siteKey === data.siteKey && (overlay.stale.has(data.sourceRevision) || overlay.revision === data.sourceRevision) ? overlay : null;
  const bars = activeOverlay?.bars ?? data?.testBars ?? EMPTY;
  const accept = (result: PlanningBoardWriteResult) => {
    if (!result.testBars) return;
    if (offlineEnabled) void refreshRead('load').catch(() => undefined);
    setOverlay((previous) => ({ siteKey: latest.current.data?.siteKey ?? '', stale: new Set([...previous?.stale ?? [], latest.current.data?.sourceRevision ?? '', previous?.revision ?? '']),
      revision: result.sourceRevision ?? '', bars: result.testBars!, next: result.nextTestBarSequence ?? previous?.next ?? data?.nextTestBarSequence ?? 1 }));
  };
  const mutate = (item: GrindingPlanningBoardTestBar, action: 'delete' | 'restore' | 'complete' | 'incomplete', onSaved?: (result: GrindingPlanningBoardTestBarMutationResponse) => void) => {
    if (disabled) return false;
    let saved: GrindingPlanningBoardTestBarMutationResponse | undefined;
    return enqueue({ label: 'テスト加工', itemIds: [item.itemId], seibans: [], order: true, apply: (display) => display,
      save: async (context) => {
        const current = (latest.current.overlay?.siteKey === latest.current.data?.siteKey ? latest.current.overlay?.bars : latest.current.data?.testBars)?.find((candidate) => candidate.itemId === item.itemId) ?? item;
        saved = await mutateKioskGrindingPlanningBoardTestBar(item.itemId, action, { dueSource: latest.current.data?.dueSource, sourceRevision: context.sourceRevision, expectedVersion: current.version });
        return saved;
      }, onSaved: (result) => { accept(result); if (saved) onSaved?.(saved); }
    });
  };
  return { bars, selectedId, selectedBar: bars.find((item) => item.itemId === selectedId) ?? null,
    nextSequence: activeOverlay?.next ?? data?.nextTestBarSequence ?? 1, disabled,
    select: (item, selected) => setSelectedId(item.kind === 'test' && selected ? item.itemId : null), accept,
    create: (resourceCd, minutes, after) => new Promise((resolve) => {
      if (disabled) { resolve(false); return; }
      let saved: GrindingPlanningBoardTestBarMutationResponse | undefined;
      const queued = enqueue({ label: 'テスト加工', itemIds: after ? [after.itemId] : [], seibans: [], order: true, apply: (display) => display,
        save: async (context) => {
          const current = after?.kind === 'test' ? (latest.current.overlay?.siteKey === latest.current.data?.siteKey ? latest.current.overlay?.bars : latest.current.data?.testBars)?.find((bar) => bar.itemId === after.itemId) ?? after : after ? context.item(after) : undefined;
          const request: GrindingPlanningBoardTestBarCreateRequest = { dueSource: latest.current.data?.dueSource, sourceRevision: context.sourceRevision, resourceCd, minutes,
            ...(current ? { afterItem: { itemId: current.itemId, itemRevision: current.itemRevision, overrideVersion: current.version } } : {}) };
          saved = await createKioskGrindingPlanningBoardTestBar(request); return saved;
        }, onSaved: (result) => { accept(result); if (saved) { setSelectedId(saved.testBar.itemId); remember(saved.testBar, 'delete'); } resolve(true); },
        onFailed: () => resolve(false), onDiscarded: () => resolve(false)
      });
      if (!queued) resolve(false);
    }),
    remove: (item) => { mutate(item, 'delete', (result) => { remember(result.testBar, 'restore'); setSelectedId(null); }); },
    complete: (item, intent) => { mutate(item, intent); },
    undo: (entry, done) => {
      if (!entry.testBarUndo) return false;
      return mutate(entry.testBarUndo.item, entry.testBarUndo.action, () => { setSelectedId(entry.testBarUndo!.action === 'restore' ? entry.testBarUndo!.item.itemId : null); done(); });
    }
  };
}
