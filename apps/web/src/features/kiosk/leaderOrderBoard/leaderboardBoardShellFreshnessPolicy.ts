import type {
  KioskProductionScheduleLeaderboardBoardQueryParams,
  ProductionScheduleLeaderboardBoardResponse
} from '../../../api/client';

export type LeaderboardShellPlaceholderSuppressInput = {
  paramsKey: string;
  isPlaceholderData: boolean;
  /** 最後に本物の shell を受け取ったときの paramsKey（未確定なら null） */
  lastCommittedParamsKey: string | null;
};

/**
 * queryKey（paramsKey）変更直後の placeholder が、旧 params の shell を載せているとき true。
 * 同一 params の refetch placeholder は false（KB-374 表示安定化を維持）。
 */
export function shouldSuppressLeaderboardShellPlaceholder(
  input: LeaderboardShellPlaceholderSuppressInput
): boolean {
  if (!input.isPlaceholderData) return false;
  if (input.lastCommittedParamsKey == null) return false;
  return input.lastCommittedParamsKey !== input.paramsKey;
}

/**
 * 表示継続の鮮度判定用 key。`includeLabor` は行の集合・並びを変えないため、
 * 旧 shell を表示したまま労務付き shell の再取得を待てる。
 */
export function buildLeaderboardShellDisplayFreshnessKey(
  params: KioskProductionScheduleLeaderboardBoardQueryParams | undefined
): string {
  if (params == null) return '';
  const { includeLabor: _includeLabor, ...displayFreshnessParams } = params;
  void _includeLabor;
  return JSON.stringify(displayFreshnessParams);
}

export function resolveLeaderboardShellForDisplay(
  shell: ProductionScheduleLeaderboardBoardResponse | undefined,
  suppressPlaceholderShell: boolean
): ProductionScheduleLeaderboardBoardResponse | undefined {
  if (suppressPlaceholderShell) return undefined;
  return shell;
}

/** append ループ開始に使ってよい shell か（placeholder 不一致時は開始しない） */
export function isLeaderboardShellReadyForAppend(input: {
  suppressPlaceholderShell: boolean;
  shell: ProductionScheduleLeaderboardBoardResponse | undefined;
}): boolean {
  return !input.suppressPlaceholderShell && input.shell != null;
}
