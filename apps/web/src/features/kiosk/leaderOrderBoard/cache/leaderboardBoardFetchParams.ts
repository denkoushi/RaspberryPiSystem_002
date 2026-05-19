import type {
  KioskProductionScheduleLeaderboardBoardQueryParams,
  KioskProductionScheduleLeaderboardPhasedQueryParams
} from '../../../../api/client';

/** 登録製番 OR（`activeQueries`）を API `q` へ（カンマ区切り・空除去） */
export function buildLeaderboardSeibanOrQueryText(seibanTokens: readonly string[]): string | undefined {
  const tokens = Array.from(
    new Set(
      seibanTokens
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    )
  );
  if (tokens.length === 0) return undefined;
  return tokens.join(',');
}

/** 順位ボード正本 GET 用: `q` を載せない base params */
export function buildLeaderboardBoardBaseFetchParams(input: {
  phasedBase: KioskProductionScheduleLeaderboardPhasedQueryParams;
  boardResourceCds: readonly string[];
}): KioskProductionScheduleLeaderboardBoardQueryParams {
  const { q: _omitQ, ...rest } = input.phasedBase;
  void _omitQ;
  return {
    ...rest,
    boardResourceCds: input.boardResourceCds.join(','),
    includeDecorations: false
  };
}

/** 製番 OR 照合用: base + `q` */
export function buildLeaderboardBoardReconcileFetchParams(input: {
  phasedBase: KioskProductionScheduleLeaderboardPhasedQueryParams;
  boardResourceCds: readonly string[];
  seibanOrFilters: readonly string[];
}): KioskProductionScheduleLeaderboardBoardQueryParams | undefined {
  const q = buildLeaderboardSeibanOrQueryText(input.seibanOrFilters);
  if (q == null) return undefined;
  const { q: _omitQ, ...rest } = input.phasedBase;
  void _omitQ;
  return {
    ...rest,
    q,
    boardResourceCds: input.boardResourceCds.join(','),
    includeDecorations: false
  };
}

/** クライアントフィルタ無効時の従来経路: `q` を params に含める */
export function buildLeaderboardBoardLegacyFetchParams(input: {
  phasedBase: KioskProductionScheduleLeaderboardPhasedQueryParams;
  boardResourceCds: readonly string[];
  seibanOrFilters: readonly string[];
}): KioskProductionScheduleLeaderboardBoardQueryParams {
  const q = buildLeaderboardSeibanOrQueryText(input.seibanOrFilters);
  return {
    ...input.phasedBase,
    ...(q != null ? { q } : {}),
    boardResourceCds: input.boardResourceCds.join(','),
    includeDecorations: false
  };
}
