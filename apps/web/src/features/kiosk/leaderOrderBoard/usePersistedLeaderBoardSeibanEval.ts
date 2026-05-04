import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  LEADER_BOARD_SEIBAN_EVAL_SCHEMA_VERSION,
  persistedLeaderBoardSeibanEvalStorageKey,
  type PersistedLeaderBoardSeibanEval
} from './constants';
import { mergeSharedHistoryWithLocalOrder } from './seibanPriority/mergeSharedHistoryWithLocalOrder';
import { reorderSeibanInMergedList } from './seibanPriority/reorderSeibanInMergedList';

function loadPersistedSeibanEval(storageKey: string): Pick<PersistedLeaderBoardSeibanEval, 'enabled' | 'localOrder'> {
  if (typeof window === 'undefined') {
    return { enabled: false, localOrder: [] };
  }
  const raw = window.localStorage.getItem(storageKey);
  if (!raw?.trim()) {
    return { enabled: false, localOrder: [] };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedLeaderBoardSeibanEval> | null;
    if (!parsed || parsed.schemaVersion !== LEADER_BOARD_SEIBAN_EVAL_SCHEMA_VERSION) {
      return { enabled: false, localOrder: [] };
    }
    const enabled = Boolean(parsed.enabled);
    const lo = Array.isArray(parsed.localOrder) ? parsed.localOrder.map((s) => String(s).trim()).filter(Boolean) : [];
    return { enabled, localOrder: lo };
  } catch {
    return { enabled: false, localOrder: [] };
  }
}

function persistSeibanEval(storageKey: string, payload: Pick<PersistedLeaderBoardSeibanEval, 'enabled' | 'localOrder'>): void {
  if (typeof window === 'undefined') return;
  const body: PersistedLeaderBoardSeibanEval = {
    schemaVersion: LEADER_BOARD_SEIBAN_EVAL_SCHEMA_VERSION,
    enabled: payload.enabled,
    localOrder: payload.localOrder
  };
  window.localStorage.setItem(storageKey, JSON.stringify(body));
}

/**
 * 製番順「評価モード」とローカル製番並び。共有 `sharedHistory` とは別永続（端末ローカルのみ）。
 */
export function usePersistedLeaderBoardSeibanEval(
  siteKey: string,
  deviceScopeKey: string,
  sharedHistory: readonly string[]
) {
  const storageKey = useMemo(
    () => persistedLeaderBoardSeibanEvalStorageKey(siteKey, deviceScopeKey),
    [siteKey, deviceScopeKey]
  );

  const sharedSig = useMemo(() => sharedHistory.map((s) => s.trim()).join('\0'), [sharedHistory]);

  const [enabled, setEnabled] = useState(false);
  const [localOrder, setLocalOrder] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const loaded = loadPersistedSeibanEval(storageKey);
    setEnabled(loaded.enabled);
    setLocalOrder(loaded.localOrder);
    setHydrated(true);
  }, [storageKey]);

  useEffect(() => {
    if (!hydrated) return;
    setLocalOrder((prev) => mergeSharedHistoryWithLocalOrder(sharedHistory, prev));
  }, [hydrated, sharedHistory, sharedSig]);

  useEffect(() => {
    if (!hydrated) return;
    persistSeibanEval(storageKey, { enabled, localOrder });
  }, [hydrated, storageKey, enabled, localOrder]);

  const mergedDisplayOrder = useMemo(
    () => mergeSharedHistoryWithLocalOrder(sharedHistory, localOrder),
    [sharedHistory, localOrder]
  );

  const moveRegisteredSeiban = useCallback(
    (fseiban: string, direction: 'up' | 'down') => {
      setLocalOrder((prev) => {
        const merged = mergeSharedHistoryWithLocalOrder(sharedHistory, prev);
        return reorderSeibanInMergedList(merged, fseiban, direction);
      });
    },
    [sharedHistory]
  );

  return {
    seibanEvalEnabled: enabled,
    setSeibanEvalEnabled: setEnabled,
    mergedRegisteredSeibanOrder: mergedDisplayOrder,
    moveRegisteredSeiban
  };
}
