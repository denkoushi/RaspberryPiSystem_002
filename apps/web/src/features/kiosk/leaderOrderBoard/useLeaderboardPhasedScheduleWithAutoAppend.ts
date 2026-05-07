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
}) {
  const {
    leaderboardPhasedParams,
    scheduleEnabled,
    pauseRefetch,
    refetchIntervalMs,
    macManualOrderV2,
    activeDeviceScopeKey
  } = options;

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
  const continuePageSize = stableLeaderboardPhasedParams.pageSize;
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
  }, [paramsKey]);

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
        if (next.length >= total) {
          if (runId === runIdRef.current) setMergedRows(next);
          return;
        }

        setIsAppending(true);
        while (!cancelled && runId === runIdRef.current && next.length < total) {
          const more = await postKioskProductionScheduleLeaderboardShellContinue({
            ...continueBaseBody,
            excludeRowIds: next.map((r) => r.id),
            pageSize: continuePageSize
          });

          if (more.rows.length === 0) break;
          const seen = new Set(next.map((r) => r.id));
          const deduped = more.rows.filter((r) => !seen.has(r.id));
          if (deduped.length === 0) break;
          next = [...next, ...deduped];
          if (runId === runIdRef.current) setMergedRows(next);
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
    paramsKey,
    scheduleEnabled,
    hasFreshShell,
    shellQuery.dataUpdatedAt,
    shellRowCount,
    shellRowsKey,
    totalQuery.data?.total,
    hasFreshTotal,
    totalQuery.dataUpdatedAt
  ]);

  const leaderboardDecorationsPayload = useMemo(() => {
    if (!mergedRows || mergedRows.length === 0) return undefined;
    return {
      rowIds: mergedRows.map((r) => r.id),
      ...(macManualOrderV2 && activeDeviceScopeKey.trim().length > 0
        ? { targetDeviceScopeKey: activeDeviceScopeKey.trim() }
        : {})
    };
  }, [activeDeviceScopeKey, macManualOrderV2, mergedRows]);

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
    const chips = decorationsQuery.data?.leaderboardFooterChipsByPartKey;
    const total = totalQuery.data?.total ?? mergedRows.length;
    const rows = mergedRows.map((row): ProductionScheduleRow => {
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
        (leaderboardDecorationsPayload != null && decorationsQuery.isFetching)
    }),
    [
      decorationsQuery.isFetching,
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
