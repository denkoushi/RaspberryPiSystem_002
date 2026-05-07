import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { useKioskProductionScheduleLeaderboardDecorations } from '../../../api/hooks';

import { LEADER_ORDER_BOARD_SHELL_PAGE_SIZE } from './constants';
import { useLeaderboardPhasedScheduleWithAutoAppend } from './useLeaderboardPhasedScheduleWithAutoAppend';

import type {
  KioskProductionScheduleLeaderboardPhasedQueryParams,
  ProductionScheduleListResponse,
  ProductionScheduleRow
} from '../../../api/client';

function buildRowIdsKey(rows: readonly ProductionScheduleRow[]): string {
  return rows.map((row) => row.id).join('\0');
}

export type LeaderboardResourceCardFeedSlice = {
  rowsKey: string;
  mergedRows: ProductionScheduleRow[];
  total: number;
  appendError: Error | null;
  isShellLoading: boolean;
  isShellError: boolean;
  isFetching: boolean;
  page: number;
  pageSize: number;
};

function feedSliceEqual(a: LeaderboardResourceCardFeedSlice, b: LeaderboardResourceCardFeedSlice): boolean {
  return (
    a.rowsKey === b.rowsKey &&
    a.total === b.total &&
    (a.appendError?.message ?? '') === (b.appendError?.message ?? '') &&
    a.isShellLoading === b.isShellLoading &&
    a.isShellError === b.isShellError &&
    a.isFetching === b.isFetching &&
    a.page === b.page &&
    a.pageSize === b.pageSize
  );
}

type FeedBridgeProps = {
  resourceCd: string;
  leaderboardPhasedBaseParams: KioskProductionScheduleLeaderboardPhasedQueryParams;
  scheduleEnabled: boolean;
  pauseRefetch: boolean;
  refetchIntervalMs: number;
  macManualOrderV2: boolean;
  activeDeviceScopeKey: string;
  onFeedSlice: (resourceCd: string, slice: LeaderboardResourceCardFeedSlice) => void;
};

/**
 * 1 資源 CD 分の phased leaderboard feed。装飾は親で一括付与するため `includeDecorations: false`。
 */
function LeaderboardResourcePhasedFeedBridge(props: FeedBridgeProps) {
  const {
    resourceCd,
    leaderboardPhasedBaseParams,
    scheduleEnabled,
    pauseRefetch,
    refetchIntervalMs,
    macManualOrderV2,
    activeDeviceScopeKey,
    onFeedSlice
  } = props;

  const leaderboardPhasedParams = useMemo(
    () => ({
      ...leaderboardPhasedBaseParams,
      resourceCds: resourceCd
    }),
    [leaderboardPhasedBaseParams, resourceCd]
  );

  const { scheduleQuery, appendError } = useLeaderboardPhasedScheduleWithAutoAppend({
    leaderboardPhasedParams,
    scheduleEnabled,
    pauseRefetch,
    refetchIntervalMs,
    macManualOrderV2,
    activeDeviceScopeKey,
    includeDecorations: false
  });

  const mergedRows = useMemo(() => scheduleQuery.data?.rows ?? [], [scheduleQuery.data?.rows]);
  const rowsKey = useMemo(() => buildRowIdsKey(mergedRows), [mergedRows]);

  const onFeedSliceRef = useRef(onFeedSlice);
  onFeedSliceRef.current = onFeedSlice;

  useEffect(() => {
    onFeedSliceRef.current(resourceCd, {
      rowsKey,
      mergedRows,
      total: scheduleQuery.data?.total ?? mergedRows.length,
      appendError,
      isShellLoading: scheduleQuery.isLoading,
      isShellError: scheduleQuery.isError,
      isFetching: scheduleQuery.isFetching,
      page: scheduleQuery.data?.page ?? 1,
      pageSize: scheduleQuery.data?.pageSize ?? LEADER_ORDER_BOARD_SHELL_PAGE_SIZE
    });
  }, [
    appendError,
    mergedRows,
    resourceCd,
    rowsKey,
    scheduleQuery.data?.page,
    scheduleQuery.data?.pageSize,
    scheduleQuery.data?.total,
    scheduleQuery.isError,
    scheduleQuery.isFetching,
    scheduleQuery.isLoading
  ]);

  return null;
}

export function useCompositeLeaderboardPhasedScheduleWithAutoAppend(options: {
  /** `resourceCds` を含めない（各カードで上書きする） */
  leaderboardPhasedBaseParams: KioskProductionScheduleLeaderboardPhasedQueryParams;
  /** スロット順など、画面上のカード並び */
  resourceCdsOrdered: string[];
  scheduleEnabled: boolean;
  pauseRefetch: boolean;
  refetchIntervalMs: number;
  macManualOrderV2: boolean;
  activeDeviceScopeKey: string;
}): {
  scheduleQuery: {
    data: ProductionScheduleListResponse | undefined;
    isLoading: boolean;
    isError: boolean;
    isFetching: boolean;
  };
  appendError: Error | null;
  /** ページ直下で描画して各カード feed をマウントする */
  feedMounts: ReactNode;
  /** カード単位で total > rows のとき真（従来の listIncomplete を一般化） */
  listIncomplete: boolean;
} {
  const {
    leaderboardPhasedBaseParams,
    resourceCdsOrdered,
    scheduleEnabled,
    pauseRefetch,
    refetchIntervalMs,
    macManualOrderV2,
    activeDeviceScopeKey
  } = options;

  const baseKey = useMemo(() => JSON.stringify(leaderboardPhasedBaseParams), [leaderboardPhasedBaseParams]);
  const resourcesKey = useMemo(() => resourceCdsOrdered.join('\0'), [resourceCdsOrdered]);
  const resetKey = `${baseKey}@@${resourcesKey}`;

  const [feedMap, setFeedMap] = useState<Partial<Record<string, LeaderboardResourceCardFeedSlice>>>({});

  useEffect(() => {
    setFeedMap({});
  }, [resetKey]);

  useEffect(() => {
    if (!scheduleEnabled) setFeedMap({});
  }, [scheduleEnabled]);

  const onFeedSlice = useCallback((resourceCd: string, slice: LeaderboardResourceCardFeedSlice) => {
    setFeedMap((prev) => {
      const cur = prev[resourceCd];
      if (cur && feedSliceEqual(cur, slice)) return prev;
      return { ...prev, [resourceCd]: slice };
    });
  }, []);

  const feedMounts = useMemo(
    () => (
      <>
        {resourceCdsOrdered.map((resourceCd) => (
          <LeaderboardResourcePhasedFeedBridge
            key={`${resetKey}:${resourceCd}`}
            resourceCd={resourceCd}
            leaderboardPhasedBaseParams={leaderboardPhasedBaseParams}
            scheduleEnabled={scheduleEnabled && resourceCdsOrdered.length > 0}
            pauseRefetch={pauseRefetch}
            refetchIntervalMs={refetchIntervalMs}
            macManualOrderV2={macManualOrderV2}
            activeDeviceScopeKey={activeDeviceScopeKey}
            onFeedSlice={onFeedSlice}
          />
        ))}
      </>
    ),
    [
      activeDeviceScopeKey,
      leaderboardPhasedBaseParams,
      macManualOrderV2,
      onFeedSlice,
      pauseRefetch,
      refetchIntervalMs,
      resetKey,
      resourceCdsOrdered,
      scheduleEnabled
    ]
  );

  const mergedRowsOrdered = useMemo(() => {
    const out: ProductionScheduleRow[] = [];
    for (const rc of resourceCdsOrdered) {
      const slice = feedMap[rc];
      if (slice) out.push(...slice.mergedRows);
    }
    return out;
  }, [feedMap, resourceCdsOrdered]);

  const decorationsPayload = useMemo(() => {
    if (!scheduleEnabled || mergedRowsOrdered.length === 0) return undefined;
    return {
      rowIds: mergedRowsOrdered.map((r) => r.id),
      ...(macManualOrderV2 && activeDeviceScopeKey.trim().length > 0
        ? { targetDeviceScopeKey: activeDeviceScopeKey.trim() }
        : {})
    };
  }, [activeDeviceScopeKey, macManualOrderV2, mergedRowsOrdered, scheduleEnabled]);

  const decorationsQuery = useKioskProductionScheduleLeaderboardDecorations(decorationsPayload, {
    enabled: scheduleEnabled && mergedRowsOrdered.length > 0 && decorationsPayload != null,
    pauseRefetch,
    refetchIntervalMs
  });

  const leaderboardDecorationByRowId = useMemo(() => {
    const m = new Map<string, { resolvedMachineName: string | null; customerName: string | null }>();
    for (const d of decorationsQuery.data?.rowDecorations ?? []) {
      m.set(d.id, {
        resolvedMachineName: d.resolvedMachineName ?? null,
        customerName: d.customerName ?? null
      });
    }
    return m;
  }, [decorationsQuery.data?.rowDecorations]);

  const allFeedsPresent =
    scheduleEnabled &&
    resourceCdsOrdered.length > 0 &&
    resourceCdsOrdered.every((rc) => feedMap[rc] != null);

  const aggregatedAppendError = useMemo(() => {
    for (const rc of resourceCdsOrdered) {
      const e = feedMap[rc]?.appendError;
      if (e) return e;
    }
    return null;
  }, [feedMap, resourceCdsOrdered]);

  const listIncomplete = useMemo(() => {
    if (!scheduleEnabled || resourceCdsOrdered.length === 0) return false;
    return resourceCdsOrdered.some((rc) => {
      const slice = feedMap[rc];
      if (!slice) return false;
      return slice.total > slice.mergedRows.length;
    });
  }, [feedMap, resourceCdsOrdered, scheduleEnabled]);

  const totalSum = useMemo(() => {
    let s = 0;
    for (const rc of resourceCdsOrdered) {
      s += feedMap[rc]?.total ?? 0;
    }
    return s;
  }, [feedMap, resourceCdsOrdered]);

  const scheduleQuery = useMemo(() => {
    if (!scheduleEnabled || resourceCdsOrdered.length === 0) {
      return {
        data: undefined as ProductionScheduleListResponse | undefined,
        isLoading: false,
        isError: false,
        isFetching: false
      };
    }

    const anyLoading = resourceCdsOrdered.some((rc) => {
      const slice = feedMap[rc];
      return !slice || slice.isShellLoading;
    });
    const anyError = resourceCdsOrdered.some((rc) => feedMap[rc]?.isShellError === true);
    const anyFeedFetching = resourceCdsOrdered.some((rc) => feedMap[rc]?.isFetching === true);

    const chips = decorationsQuery.data?.leaderboardFooterChipsByPartKey;
    const first = resourceCdsOrdered[0] ? feedMap[resourceCdsOrdered[0]!] : undefined;
    const page = first?.page ?? 1;
    const pageSize = first?.pageSize ?? mergedRowsOrdered.length;

    const rows =
      allFeedsPresent || mergedRowsOrdered.length > 0
        ? mergedRowsOrdered.map((row): ProductionScheduleRow => {
            const deco = leaderboardDecorationByRowId.get(row.id);
            return deco ? { ...row, ...deco } : row;
          })
        : [];

    const data: ProductionScheduleListResponse | undefined =
      allFeedsPresent || rows.length > 0
        ? {
            page,
            pageSize,
            total: totalSum,
            rows,
            ...(chips ? { leaderboardFooterChipsByPartKey: chips } : {})
          }
        : undefined;

    return {
      data,
      isLoading: anyLoading,
      isError: anyError,
      isFetching: anyFeedFetching || (decorationsPayload != null && decorationsQuery.isFetching)
    };
  }, [
    allFeedsPresent,
    decorationsPayload,
    decorationsQuery.data?.leaderboardFooterChipsByPartKey,
    decorationsQuery.isFetching,
    feedMap,
    leaderboardDecorationByRowId,
    mergedRowsOrdered,
    resourceCdsOrdered,
    scheduleEnabled,
    totalSum
  ]);

  return {
    scheduleQuery,
    appendError: aggregatedAppendError,
    feedMounts,
    listIncomplete
  };
}
