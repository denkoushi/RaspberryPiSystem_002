import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  postKioskProductionScheduleLeaderboardShellContinue,
  type KioskProductionScheduleLeaderboardPhasedQueryParams,
  type ProductionScheduleListResponse,
  type ProductionScheduleRow
} from '../../../api/client';
import {
  useKioskProductionScheduleLeaderboardDecorations,
  useKioskProductionScheduleLeaderboardShell,
  useKioskProductionScheduleLeaderboardTotal
} from '../../../api/hooks';

import type { LeaderboardAppendAcquire } from './leaderboard-append-concurrency';

function invalidateLeaderboardDecorationsQueries(queryClient: ReturnType<typeof useQueryClient>) {
  return queryClient.invalidateQueries({
    predicate: (q) =>
      Array.isArray(q.queryKey) &&
      q.queryKey[0] === 'kiosk-production-schedule' &&
      q.queryKey[1] === 'leaderboard-decorations'
  });
}

function phasedParamsToExcludeBody(base: KioskProductionScheduleLeaderboardPhasedQueryParams): Omit<
  KioskProductionScheduleLeaderboardPhasedQueryParams,
  'page' | 'pageSize'
> {
  const { page: _unusedPage, pageSize: _unusedPageSize, ...rest } = base;
  void _unusedPage;
  void _unusedPageSize;
  return rest;
}

function buildRowIdsKey(rows: readonly ProductionScheduleRow[]): string {
  return rows.map((row) => row.id).join('\0');
}

export function useLeaderboardPhasedScheduleWithAutoAppend(options: {
  leaderboardPhasedParams: KioskProductionScheduleLeaderboardPhasedQueryParams;
  scheduleEnabled: boolean;
  pauseRefetch: boolean;
  refetchIntervalMs: number;
  macManualOrderV2: boolean;
  activeDeviceScopeKey: string;
  /**
   * `false` のとき装飾クエリを実行しない（複数資源カード合成で親が一括装飾する場合）。
   * @default true
   */
  includeDecorations?: boolean;
  /**
   * 複数カードで `leaderboard-shell` continue が同時多発しないようスロット取得（release は finally）
   */
  appendAcquire?: LeaderboardAppendAcquire;
}) {
  const {
    leaderboardPhasedParams,
    scheduleEnabled,
    pauseRefetch,
    refetchIntervalMs,
    macManualOrderV2,
    activeDeviceScopeKey,
    includeDecorations = true,
    appendAcquire
  } = options;

  const queryClient = useQueryClient();
  const paramsKey = useMemo(() => JSON.stringify(leaderboardPhasedParams), [leaderboardPhasedParams]);

  const shellQuery = useKioskProductionScheduleLeaderboardShell(leaderboardPhasedParams, {
    enabled: scheduleEnabled,
    pauseRefetch,
    refetchIntervalMs
  });

  const totalQuery = useKioskProductionScheduleLeaderboardTotal(leaderboardPhasedParams, {
    enabled: scheduleEnabled,
    pauseRefetch,
    refetchIntervalMs
  });

  const [mergedRows, setMergedRows] = useState<ProductionScheduleRow[]>([]);
  const [appendError, setAppendError] = useState<Error | null>(null);
  const [isAppending, setIsAppending] = useState(false);

  const runIdRef = useRef(0);
  const lastSyncedShellSignatureRef = useRef<string | null>(null);
  const shellRowsRef = useRef<ProductionScheduleRow[]>([]);
  const hasFreshShell = shellQuery.isSuccess && !shellQuery.isPlaceholderData;
  const hasFreshTotal = totalQuery.isSuccess && !totalQuery.isPlaceholderData;
  const shellRows = useMemo(() => shellQuery.data?.rows ?? [], [shellQuery.data?.rows]);
  const shellRowCount = shellRows.length;
  const shellRowsKey = useMemo(() => buildRowIdsKey(shellRows), [shellRows]);
  const stableLeaderboardPhasedParams = useMemo(
    () => JSON.parse(paramsKey) as KioskProductionScheduleLeaderboardPhasedQueryParams,
    [paramsKey]
  );
  const continuePageSize = stableLeaderboardPhasedParams.pageSize ?? 160;
  const continueBaseBody = useMemo(
    () => phasedParamsToExcludeBody(stableLeaderboardPhasedParams),
    [stableLeaderboardPhasedParams]
  );
  const shellSyncSignature = `${shellQuery.dataUpdatedAt}:${shellRowsKey}`;

  useEffect(() => {
    shellRowsRef.current = shellRows;
  }, [shellRows, shellRowsKey]);

  useEffect(() => {
    setMergedRows([]);
    setIsAppending(false);
    setAppendError(null);
    lastSyncedShellSignatureRef.current = null;
  }, [paramsKey, scheduleEnabled]);

  useEffect(() => {
    if (!hasFreshShell || shellRowCount === 0) {
      if (mergedRows.length > 0) setMergedRows([]);
      lastSyncedShellSignatureRef.current = null;
      return;
    }
    if (lastSyncedShellSignatureRef.current !== shellSyncSignature) {
      lastSyncedShellSignatureRef.current = shellSyncSignature;
      setMergedRows(shellRows);
    }
  }, [hasFreshShell, mergedRows.length, shellRowCount, shellRows, shellSyncSignature]);

  useEffect(() => {
    if (!scheduleEnabled || !hasFreshShell || !hasFreshTotal || shellRowCount === 0) {
      return;
    }

    const total = totalQuery.data.total;
    const runId = ++runIdRef.current;
    let cancelled = false;

    void (async () => {
      try {
        let next = shellRowsRef.current.slice();
        const snapshotIdForSession = shellQuery.data?.snapshotId?.trim();
        const shellHasMore = shellQuery.data?.hasMore ?? next.length < total;
        /** cursor 方式: shell の nextCursor を初期値に。無ければ返却行数。 */
        let cursor =
          typeof shellQuery.data?.nextCursor === 'number'
            ? shellQuery.data.nextCursor
            : shellRowsRef.current.length;
        let hasMore = snapshotIdForSession ? shellHasMore : true;

        if (next.length >= total) {
          if (runId === runIdRef.current) setMergedRows(next);
          return;
        }

        if (runId === runIdRef.current) setAppendError(null);
        setIsAppending(true);
        while (!cancelled && runId === runIdRef.current && next.length < total && hasMore) {
          const continuePayload =
            snapshotIdForSession != null && snapshotIdForSession.length > 0
              ? {
                  ...continueBaseBody,
                  pageSize: continuePageSize,
                  snapshotId: snapshotIdForSession,
                  cursor
                }
              : {
                  ...continueBaseBody,
                  pageSize: continuePageSize,
                  excludeRowIds: next.map((r) => r.id)
                };

          let release: (() => void) | undefined;
          if (appendAcquire) {
            release = await appendAcquire();
          }
          let more: Awaited<ReturnType<typeof postKioskProductionScheduleLeaderboardShellContinue>>;
          try {
            more = await postKioskProductionScheduleLeaderboardShellContinue(continuePayload);
          } finally {
            release?.();
          }

          if (more.snapshotExpired) {
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: ['kiosk-production-schedule', 'leaderboard-shell'] }),
              queryClient.invalidateQueries({ queryKey: ['kiosk-production-schedule', 'leaderboard-total'] }),
              invalidateLeaderboardDecorationsQueries(queryClient)
            ]);
            break;
          }

          if (more.rows.length === 0) {
            if (snapshotIdForSession) {
              const prevCursor = cursor;
              hasMore = Boolean(more.hasMore);
              if (typeof more.nextCursor === 'number') {
                cursor = more.nextCursor;
              }
              if (!hasMore) break;
              if (cursor <= prevCursor) break;
              continue;
            }
            break;
          }
          const seen = new Set(next.map((r) => r.id));
          const deduped = more.rows.filter((r) => !seen.has(r.id));
          if (deduped.length === 0) break;
          next = [...next, ...deduped];
          if (runId === runIdRef.current) setMergedRows(next);
          cursor =
            typeof more.nextCursor === 'number' ? more.nextCursor : cursor + more.rows.length;
          hasMore =
            typeof more.hasMore === 'boolean'
              ? more.hasMore
              : cursor < total || more.rows.length >= continuePageSize;
        }
      } catch (e) {
        if (!cancelled && runId === runIdRef.current) {
          setAppendError(e instanceof Error ? e : new Error(String(e)));
        }
      } finally {
        if (runId === runIdRef.current) setIsAppending(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    continueBaseBody,
    continuePageSize,
    leaderboardPhasedParams,
    paramsKey,
    queryClient,
    scheduleEnabled,
    hasFreshShell,
    shellQuery.data?.snapshotId,
    shellQuery.data?.hasMore,
    shellQuery.data?.nextCursor,
    shellQuery.dataUpdatedAt,
    shellRowCount,
    shellRowsKey,
    totalQuery.data?.total,
    hasFreshTotal,
    totalQuery.dataUpdatedAt,
    appendAcquire
  ]);

  const leaderboardDecorationsPayload = useMemo(() => {
    if (!includeDecorations) return undefined;
    if (!mergedRows || mergedRows.length === 0) return undefined;
    return {
      rowIds: mergedRows.map((r) => r.id),
      ...(macManualOrderV2 && activeDeviceScopeKey.trim().length > 0
        ? { targetDeviceScopeKey: activeDeviceScopeKey.trim() }
        : {})
    };
  }, [activeDeviceScopeKey, includeDecorations, macManualOrderV2, mergedRows]);

  const decorationsQuery = useKioskProductionScheduleLeaderboardDecorations(leaderboardDecorationsPayload, {
    enabled: scheduleEnabled && mergedRows.length > 0 && leaderboardDecorationsPayload != null,
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

  const mergedLeaderboardScheduleData = useMemo((): ProductionScheduleListResponse | undefined => {
    if (!shellQuery.data) return undefined;
    const chips = includeDecorations ? decorationsQuery.data?.leaderboardFooterChipsByPartKey : undefined;
    const total = totalQuery.data?.total ?? mergedRows.length;
    const rows = mergedRows.map((row): ProductionScheduleRow => {
      if (!includeDecorations) return row;
      const deco = leaderboardDecorationByRowId.get(row.id);
      return deco ? { ...row, ...deco } : row;
    });
    return {
      page: shellQuery.data.page,
      pageSize: shellQuery.data.pageSize,
      total,
      rows,
      ...(chips ? { leaderboardFooterChipsByPartKey: chips } : {})
    };
  }, [
    decorationsQuery.data?.leaderboardFooterChipsByPartKey,
    includeDecorations,
    leaderboardDecorationByRowId,
    mergedRows,
    shellQuery.data,
    totalQuery.data?.total
  ]);

  const scheduleQuery = useMemo(
    () => ({
      data: mergedLeaderboardScheduleData,
      isLoading: shellQuery.isLoading,
      isError: shellQuery.isError || totalQuery.isError,
      isFetching:
        shellQuery.isFetching ||
        totalQuery.isFetching ||
        isAppending ||
        (includeDecorations &&
          leaderboardDecorationsPayload != null &&
          decorationsQuery.isFetching)
    }),
    [
      decorationsQuery.isFetching,
      includeDecorations,
      isAppending,
      leaderboardDecorationsPayload,
      mergedLeaderboardScheduleData,
      shellQuery.isError,
      shellQuery.isFetching,
      shellQuery.isLoading,
      totalQuery.isError,
      totalQuery.isFetching
    ]
  );

  return { scheduleQuery, appendError };
}
