import type {
  KioskProductionScheduleLeaderboardBoardQueryParams,
  KioskProductionScheduleLeaderboardPhasedQueryParams
} from '../../../../api/client';

export type LeaderboardBoardPhasedBaseFetchParams =
  KioskProductionScheduleLeaderboardPhasedQueryParams &
    Pick<KioskProductionScheduleLeaderboardBoardQueryParams, 'includeLabor'>;

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

/** board light shell GET: 行骨格のみ取得し、装飾と exact total は後段へ defer する */
export function applyLeaderboardBoardLightShellFetchPolicy(
  params: KioskProductionScheduleLeaderboardBoardQueryParams
): KioskProductionScheduleLeaderboardBoardQueryParams {
  return {
    ...params,
    includeDecorations: false,
    includeLabor: false,
    deferTotals: true
  };
}

/** 順位ボード正本 GET 用: `q` を載せない base params */
export function buildLeaderboardBoardBaseFetchParams(input: {
  phasedBase: LeaderboardBoardPhasedBaseFetchParams;
  boardResourceCds: readonly string[];
}): KioskProductionScheduleLeaderboardBoardQueryParams {
  const { q: _omitQ, ...rest } = input.phasedBase;
  void _omitQ;
  return applyLeaderboardBoardLightShellFetchPolicy({
    ...rest,
    boardResourceCds: input.boardResourceCds.join(',')
  });
}

/** 製番 OR 照合用: base + `q` */
export function buildLeaderboardBoardReconcileFetchParams(input: {
  phasedBase: LeaderboardBoardPhasedBaseFetchParams;
  boardResourceCds: readonly string[];
  seibanOrFilters: readonly string[];
}): KioskProductionScheduleLeaderboardBoardQueryParams | undefined {
  const q = buildLeaderboardSeibanOrQueryText(input.seibanOrFilters);
  if (q == null) return undefined;
  const { q: _omitQ, ...rest } = input.phasedBase;
  void _omitQ;
  return applyLeaderboardBoardLightShellFetchPolicy({
    ...rest,
    q,
    boardResourceCds: input.boardResourceCds.join(',')
  });
}

/** クライアントフィルタ無効時の従来経路: `q` を params に含める */
export function buildLeaderboardBoardLegacyFetchParams(input: {
  phasedBase: LeaderboardBoardPhasedBaseFetchParams;
  boardResourceCds: readonly string[];
  seibanOrFilters: readonly string[];
}): KioskProductionScheduleLeaderboardBoardQueryParams {
  const q = buildLeaderboardSeibanOrQueryText(input.seibanOrFilters);
  return applyLeaderboardBoardLightShellFetchPolicy({
    ...input.phasedBase,
    ...(q != null ? { q } : {}),
    boardResourceCds: input.boardResourceCds.join(',')
  });
}
