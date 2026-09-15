import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { GrindingPlanningBoardItem } from '@raspi-system/shared-types';

export type PlanningBoardDisplayItem = GrindingPlanningBoardItem & { pendingSpecialDue?: 'today' | 'overnight' | null };
export type PlanningBoardWriteDisplay = { items: PlanningBoardDisplayItem[]; order: string[] };
export type PlanningBoardWriteResult = {
  items?: GrindingPlanningBoardItem[];
  order?: string[];
  sourceRevision?: string;
};
export type PlanningBoardWriteContext = {
  item: (original: GrindingPlanningBoardItem) => GrindingPlanningBoardItem;
  sourceRevision: string;
};
export type PlanningBoardWrite = {
  label: string;
  itemIds: readonly string[];
  seibans: readonly string[];
  wholeSeiban?: boolean;
  order?: boolean;
  apply: (display: PlanningBoardWriteDisplay) => PlanningBoardWriteDisplay;
  save: (context: PlanningBoardWriteContext) => Promise<PlanningBoardWriteResult>;
  onSaved?: (result: PlanningBoardWriteResult) => void;
  onFailed?: (error: unknown) => void;
};
type Confirmed = { item: GrindingPlanningBoardItem; stale: Set<string> };
type Options = {
  scope: string;
  items: GrindingPlanningBoardItem[];
  order: string[];
  sourceRevision: string;
  refresh: () => Promise<unknown>;
  onStart: (label: string) => void;
  onSuccess: (label: string) => void;
  onError: (error: unknown) => void;
};

function overlap(a: PlanningBoardWrite, b: PlanningBoardWrite): boolean {
  return Boolean(a.order && b.order) || a.itemIds.some((id) => b.itemIds.includes(id)) ||
    Boolean((a.wholeSeiban || b.wholeSeiban) && a.seibans.some((id) => b.seibans.includes(id)));
}
function savedFields(base: GrindingPlanningBoardItem, saved: GrindingPlanningBoardItem): GrindingPlanningBoardItem {
  return { ...base, itemRevision: saved.itemRevision, version: saved.version,
    alternateRank: saved.alternateRank, effectiveResourceCd: saved.effectiveResourceCd,
    effectiveDueDate: saved.effectiveDueDate, specialDue: saved.specialDue };
}

/** A single board writer keeps accepted display intents above acknowledged server state. */
export function usePlanningBoardWriteQueue(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const createState = () => ({ scope: options.scope, writes: [] as PlanningBoardWrite[], confirmed: new Map<string, Confirmed>(),
    confirmedOrder: null as null | { order: string[]; sourceRevision: string; stale: Set<string> },
    sourceRevision: options.sourceRevision, running: false, recovering: false, blocked: false });
  const state = useRef(createState());
  const mounted = useRef(true);
  const [revision, render] = useState(0);
  const changed = useCallback(() => { if (mounted.current) render((value) => value + 1); }, []);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; state.current.writes = []; }; }, []);
  useEffect(() => {
    const current = state.current;
    if (current.scope !== options.scope) {
      state.current = createState();
      changed();
      return;
    }
    if (current.running || current.recovering) return;
    let dirty = false;
    for (const item of options.items) {
      const saved = current.confirmed.get(item.itemId);
      if (saved && (item.itemRevision === saved.item.itemRevision || !saved.stale.has(item.itemRevision))) {
        current.confirmed.delete(item.itemId); dirty = true;
      }
    }
    const savedOrder = current.confirmedOrder;
    if (savedOrder && (savedOrder.sourceRevision === options.sourceRevision || !savedOrder.stale.has(options.sourceRevision))) {
      current.confirmedOrder = null; dirty = true;
    }
    if (!current.confirmedOrder) current.sourceRevision = options.sourceRevision;
    if (dirty) changed();
  // State is reconstructed only when the owning board scope changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.scope, options.items, options.order, options.sourceRevision, revision, changed]);

  const display = useMemo(() => {
    const current = state.current;
    if (current.scope !== options.scope) return { items: options.items, order: options.order };
    let result: PlanningBoardWriteDisplay = {
      items: options.items.map((item) => {
        const saved = current.confirmed.get(item.itemId)?.item;
        return saved ? savedFields(item, saved) : item;
      }),
      order: current.confirmedOrder?.order ?? options.order
    };
    for (const write of current.writes) result = write.apply(result);
    return result;
  // Ref-owned queue mutations invalidate the projection through revision.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.scope, options.items, options.order, revision]);

  const enqueue = useCallback((write: PlanningBoardWrite): boolean => {
    const current = state.current;
    if (current.scope !== latest.current.scope || current.blocked || current.recovering) return false;
    current.writes.push(write);
    changed();
    if (current.running) return true;
    current.running = true;
    latest.current.onStart(write.label);
    const run = async () => {
      let failed = false;
      let lastLabel = write.label;
      try {
        while (mounted.current && current === state.current && current.writes.length > 0) {
          const next = current.writes[0];
          lastLabel = next.label;
          const requestRevision = current.sourceRevision;
          const requestItems = latest.current.items;
          try {
            const result = await next.save({ sourceRevision: current.sourceRevision,
              item: (original) => current.confirmed.get(original.itemId)?.item ?? original });
            if (!mounted.current || current !== state.current) return;
            if (result.sourceRevision) current.sourceRevision = result.sourceRevision;
            for (const item of result.items ?? []) {
              const previous = current.confirmed.get(item.itemId);
              const base = latest.current.items.find((candidate) => candidate.itemId === item.itemId);
              const stale = new Set(previous?.stale);
              if (previous) stale.add(previous.item.itemRevision);
              const requestItem = requestItems.find((candidate) => candidate.itemId === item.itemId);
              if (requestItem) stale.add(requestItem.itemRevision);
              current.confirmed.set(item.itemId, { item: base ? savedFields(base, item) : item, stale });
            }
            if (result.order) {
              const stale = new Set(current.confirmedOrder?.stale);
              stale.add(requestRevision);
              if (current.confirmedOrder) stale.add(current.confirmedOrder.sourceRevision);
              current.confirmedOrder = { order: result.order, sourceRevision: current.sourceRevision, stale };
            }
            current.writes.shift();
            next.onSaved?.(result);
            changed();
          } catch (error) {
            if (!mounted.current || current !== state.current) return;
            failed = true;
            const cancelled = [next];
            current.writes = current.writes.slice(1).filter((candidate) => {
              if (!cancelled.some((prior) => overlap(prior, candidate))) return true;
              cancelled.push(candidate); return false;
            });
            for (const cancelledWrite of cancelled) cancelledWrite.onFailed?.(error);
            current.recovering = true;
            latest.current.onError(error);
            changed();
            try {
              const refreshed = await latest.current.refresh();
              if (refreshed && typeof refreshed === 'object' && 'isError' in refreshed && refreshed.isError) throw new Error('Refresh failed');
            } catch {
              current.blocked = true;
              for (const pending of current.writes) pending.onFailed?.(error);
              current.writes = [];
            } finally {
              current.recovering = false;
              changed();
            }
            if (current.blocked) break;
          }
        }
        if (!mounted.current || current !== state.current) return;
        if (!failed) {
          latest.current.onSuccess(lastLabel);
          // One reconciliation per drained batch, rather than one refetch per click.
          void Promise.resolve().then(() => latest.current.refresh()).catch(() => {
            // Keep confirmed writes visible until polling or explicit refresh reconciles them.
          });
        }
      } finally {
        current.running = false;
        changed();
      }
    };
    void run();
    return true;
  }, [changed]);

  const acceptRefreshedState = useCallback(() => {
    if (state.current.running) return;
    state.current.confirmed.clear(); state.current.confirmedOrder = null;
    state.current.sourceRevision = latest.current.sourceRevision;
    state.current.blocked = false;
    changed();
  }, [changed]);
  const hasPendingSeiban = useCallback((fseiban: string, wholeOnly = false) => state.current.writes.some((write) =>
    (!wholeOnly || write.wholeSeiban) && write.seibans.includes(fseiban)), []);
  return { ...display, enqueue, pending: state.current.running || state.current.recovering,
    blocked: state.current.blocked || state.current.recovering, hasPendingSeiban, acceptRefreshedState };
}
