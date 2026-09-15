import { useEffect, useMemo, useRef, useState } from 'react';

import { sortGrindingPlanningBoardItems } from './sortGrindingPlanningBoardItems';

import type { GrindingPlanningBoardItem, GrindingPlanningBoardResourceOrderPlacement, GrindingPlanningBoardResourceOrderRequest, GrindingPlanningBoardResourceOrderResponse } from '@raspi-system/shared-types';

type Move = { item: GrindingPlanningBoardItem; target: GrindingPlanningBoardItem; placement: GrindingPlanningBoardResourceOrderPlacement };
type Confirmed = { item: GrindingPlanningBoardItem; stale: Set<string> };
type Options = {
  scope: string;
  items: GrindingPlanningBoardItem[];
  seibanOrder: string[];
  sourceRevision: string;
  save: (request: GrindingPlanningBoardResourceOrderRequest) => Promise<GrindingPlanningBoardResourceOrderResponse>;
  refresh: () => Promise<unknown>;
  onStart: () => void;
  onSuccess: () => void;
  onError: (error: unknown) => void;
};

/** Keep display intent ahead of a single writer; revisions only come from confirmed saves. */
export function usePlanningBoardReorderQueue(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const state = useRef({ scope: options.scope, moves: [] as Move[], confirmed: new Map<string, Confirmed>(), running: false });
  const [revision, render] = useState(0);
  const [recovering, setRecovering] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; state.current.moves = []; }; }, []);
  const changed = () => { if (mounted.current) render((value) => value + 1); };

  useEffect(() => {
    const current = state.current;
    if (current.scope !== options.scope) {
      state.current = { scope: options.scope, moves: [], confirmed: new Map(), running: false };
      setBlocked(false);
      setRecovering(false);
      changed();
      return;
    }
    if (current.running) return;
    let dirty = false;
    for (const item of options.items) {
      const saved = current.confirmed.get(item.itemId);
      if (saved && (item.itemRevision === saved.item.itemRevision || !saved.stale.has(item.itemRevision))) {
        current.confirmed.delete(item.itemId);
        dirty = true;
      }
    }
    if (dirty) changed();
  }, [options.items, options.scope, revision]);

  const items = useMemo(() => {
    const current = state.current;
    if (current.scope !== options.scope) return options.items;
    let result = options.items.map((item) => {
      const saved = current.confirmed.get(item.itemId)?.item;
      return saved ? { ...item, alternateRank: saved.alternateRank, itemRevision: saved.itemRevision, version: saved.version } : item;
    });
    for (const move of current.moves) {
      const resource = move.item.effectiveResourceCd ?? move.item.originalResourceCd;
      const band = move.item.specialDue?.expiresAt ?? null;
      const ordered = sortGrindingPlanningBoardItems(result.filter((item) =>
        (item.effectiveResourceCd ?? item.originalResourceCd) === resource && (item.specialDue?.expiresAt ?? null) === band
      ), options.seibanOrder, 'resource', 'alternate');
      const from = ordered.findIndex((item) => item.itemId === move.item.itemId);
      if (from < 0 || !ordered.some((item) => item.itemId === move.target.itemId)) continue;
      const [moved] = ordered.splice(from, 1);
      ordered.splice(ordered.findIndex((item) => item.itemId === move.target.itemId) + (move.placement === 'after' ? 1 : 0), 0, moved);
      const ranks = new Map(ordered.map((item, index) => [item.itemId, index + 1]));
      result = result.map((item) => ranks.has(item.itemId) ? { ...item, alternateRank: ranks.get(item.itemId)! } : item);
    }
    return result;
  // Queue mutations advance revision without replacing the coordinator ref.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.items, options.scope, options.seibanOrder, revision]);

  const enqueue = (move: Move) => {
    const current = state.current;
    if (blocked || recovering || current.scope !== options.scope) return;
    current.moves.push(move);
    changed();
    if (current.running) return;
    current.running = true;
    options.onStart();
    const run = async () => {
      let sourceRevision = options.sourceRevision;
      try {
        while (mounted.current && current === state.current && current.moves.length > 0) {
          const next = current.moves[0];
          const item = current.confirmed.get(next.item.itemId)?.item ?? next.item;
          const target = current.confirmed.get(next.target.itemId)?.item ?? next.target;
          const response = await options.save({ sourceRevision, itemId: item.itemId, itemRevision: item.itemRevision, overrideVersion: item.version,
            targetItemId: target.itemId, targetItemRevision: target.itemRevision, targetOverrideVersion: target.version, placement: next.placement });
          if (!mounted.current || current !== state.current) return;
          sourceRevision = response.sourceRevision;
          for (const saved of response.items) {
            const prior = current.confirmed.get(saved.itemId);
            const base = latest.current.items.find((candidate) => candidate.itemId === saved.itemId);
            const stale = new Set(prior?.stale);
            if (prior) stale.add(prior.item.itemRevision);
            if (base) stale.add(base.itemRevision);
            current.confirmed.set(saved.itemId, { item: saved, stale });
          }
          current.moves.shift();
          changed();
        }
        if (mounted.current && current === state.current) options.onSuccess();
      } catch (error) {
        if (!mounted.current || current !== state.current) return;
        current.moves = [];
        setRecovering(true);
        changed();
        options.onError(error);
        try {
          const result = await options.refresh();
          if (result && typeof result === 'object' && 'isError' in result && result.isError) throw new Error('Refresh failed');
          if (current === state.current) current.confirmed.clear();
        } catch {
          if (current === state.current) setBlocked(true);
        } finally {
          if (mounted.current && current === state.current) setRecovering(false);
        }
      } finally {
        current.running = false;
        changed();
      }
    };
    void run();
  };
  const acceptRefreshedState = () => {
    if (state.current.running) return;
    state.current.confirmed.clear();
    setBlocked(false);
    changed();
  };
  return { items, enqueue, pending: state.current.running || recovering, blocked: blocked || recovering, acceptRefreshedState };
}
