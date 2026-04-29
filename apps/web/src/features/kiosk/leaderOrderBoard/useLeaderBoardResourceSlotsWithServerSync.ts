import { useCallback, useEffect, useMemo, useRef } from 'react';

import { useUpdateKioskProductionScheduleManualOrderResourceAssignments } from '../../../api/hooks';

import { applyOrderedResourceCdsToSlots, normalizeDistinctOrderedResourceCds } from './applyOrderedResourceCdsToSlots';
import { type UseLeaderBoardResourceSlotsOptions, useLeaderBoardResourceSlots } from './useLeaderBoardResourceSlots';

const PUSH_DEBOUNCE_MS = 450;

function orderedCdsEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export type UseLeaderBoardResourceSlotsWithServerSyncOptions = UseLeaderBoardResourceSlotsOptions & {
  /** 工場（manual-order と同一 siteKey） */
  siteKey: string;
  deviceScopeKey: string;
  /** assignments GET の結果由来。未取得なら同期マージしない */
  serverOrderedResourceCds: string[] | undefined;
  /** 資源一覧と割当クエリが揃っているときのみ PUT */
  assignmentsQuerySuccess: boolean;
  /** PUT を送る許可（端末選択・画面有効） */
  enabled: boolean;
};

/**
 * localStorage のスロット本数・行を維持しつつ、`manual-order-resource-assignments` と resourceCds 順を双方向同期する。
 */
export function useLeaderBoardResourceSlotsWithServerSync({
  siteKey,
  deviceScopeKey,
  serverOrderedResourceCds,
  assignmentsQuerySuccess,
  enabled,
  ...slotsOptions
}: UseLeaderBoardResourceSlotsWithServerSyncOptions) {
  const {
    slotCount,
    setSlotCount,
    resourceCdBySlotIndex,
    assignSlotCd,
    clearSlot,
    activeResourceCds,
    replaceSlotPattern,
    isHydrated
  } = useLeaderBoardResourceSlots(slotsOptions);
  const updateAssignments = useUpdateKioskProductionScheduleManualOrderResourceAssignments();

  const deviceTrim = deviceScopeKey.trim();
  const siteTrim = siteKey.trim();

  const lastMergedServerSigRef = useRef<string | null>(null);
  const lastPushedSigRef = useRef<string | null>(null);
  const pushTimerRef = useRef<number | null>(null);

  /** サイト／端末／スコープ変更時は同期シグネチャをリセット */
  useEffect(() => {
    lastMergedServerSigRef.current = null;
    lastPushedSigRef.current = null;
  }, [slotsOptions.scopeKey, siteTrim, deviceTrim]);

  const serverNormalized = useMemo(
    () =>
      serverOrderedResourceCds == null ? undefined : normalizeDistinctOrderedResourceCds(serverOrderedResourceCds),
    [serverOrderedResourceCds]
  );

  const serverSerialized = useMemo(
    () => (serverNormalized == null ? null : JSON.stringify(serverNormalized)),
    [serverNormalized]
  );
  const activeResourceCdsKey = JSON.stringify(activeResourceCds);

  const mergeFromServer = useCallback(() => {
    if (!isHydrated || serverNormalized === undefined || serverSerialized == null) return;
    if (lastMergedServerSigRef.current === serverSerialized) return;

    /**
     * サーバ側がまだ空でローカルのみ選択がある場合は上書きしない（未取得行の [] と競合しないようにする）。
     * ユーザーが明示的に同期したいときは PUSH でサーバ側が埋まる。
     */
    if (serverNormalized.length === 0 && activeResourceCds.length > 0) {
      lastMergedServerSigRef.current = serverSerialized;
      return;
    }

    lastMergedServerSigRef.current = serverSerialized;

    if (orderedCdsEqual(activeResourceCds, serverNormalized)) return;

    // サーバ優先マージ直後の同一コミットで古いローカル順を PUT しないよう抑止する。
    lastPushedSigRef.current = activeResourceCdsKey;
    replaceSlotPattern(applyOrderedResourceCdsToSlots(slotCount, serverNormalized));
  }, [
    activeResourceCds,
    activeResourceCdsKey,
    isHydrated,
    replaceSlotPattern,
    serverNormalized,
    serverSerialized,
    slotCount
  ]);

  useEffect(() => {
    if (!assignmentsQuerySuccess || serverNormalized === undefined) return;
    mergeFromServer();
  }, [assignmentsQuerySuccess, mergeFromServer, serverNormalized]);

  useEffect(() => {
    if (!enabled || !isHydrated) return;
    if (!assignmentsQuerySuccess) return;
    if (!siteTrim.length || !deviceTrim.length) return;

    if (orderedCdsEqual(activeResourceCds, serverNormalized ?? [])) {
      lastPushedSigRef.current = activeResourceCdsKey;
    }

    if (lastPushedSigRef.current === activeResourceCdsKey) return;

    if (pushTimerRef.current != null) {
      window.clearTimeout(pushTimerRef.current);
      pushTimerRef.current = null;
    }

    pushTimerRef.current = window.setTimeout(() => {
      pushTimerRef.current = null;
      const cds = [...activeResourceCds];

      updateAssignments.mutate(
        {
          siteKey: siteTrim,
          deviceScopeKey: deviceTrim,
          resourceCds: cds
        },
        {
          onSuccess: () => {
            lastPushedSigRef.current = JSON.stringify(cds);
          }
        }
      );
    }, PUSH_DEBOUNCE_MS);

    return () => {
      if (pushTimerRef.current != null) {
        window.clearTimeout(pushTimerRef.current);
        pushTimerRef.current = null;
      }
    };
  }, [
    activeResourceCds,
    activeResourceCdsKey,
    assignmentsQuerySuccess,
    deviceTrim,
    enabled,
    isHydrated,
    serverNormalized,
    siteTrim,
    updateAssignments
  ]);

  return {
    slotCount,
    setSlotCount,
    resourceCdBySlotIndex,
    assignSlotCd,
    clearSlot,
    activeResourceCds,
    replaceSlotPattern,
    isHydrated,
    resourceSlotsPushPending: updateAssignments.isPending
  } as const;
}
