/**
 * shell priority（manual + 製番展開）取得計画。
 * prefix 初回のみ manual LIMIT / expansion スキップを適用する。
 */

export type LeaderboardShellPriorityFetchPlan = {
  /** manual SELECT の LIMIT（null = 無制限・continue 等） */
  manualSqlLimit: number | null;
  /** true のとき expansion クエリを実行しない */
  skipExpansionAfterManual: boolean;
};

export type LeaderboardShellPriorityFetchPlanInput = {
  /** shell 初回 prefix 取得時のみ指定 */
  prefixLimit?: number;
};

/**
 * prefix 経路: manual を `prefixLimit + 1` 件まで取得し、
 * 件数 >= prefixLimit なら expansion をスキップ（手動行だけで prefix が埋まる）。
 */
export function computeLeaderboardShellPriorityFetchPlan(
  params: LeaderboardShellPriorityFetchPlanInput
): LeaderboardShellPriorityFetchPlan {
  const prefixLimit =
    params.prefixLimit != null ? Math.max(1, Math.floor(params.prefixLimit)) : undefined;

  if (prefixLimit == null) {
    return {
      manualSqlLimit: null,
      skipExpansionAfterManual: false
    };
  }

  return {
    manualSqlLimit: prefixLimit + 1,
    skipExpansionAfterManual: false
  };
}

/**
 * manual 取得後に expansion スキップ可否を確定する。
 */
export function resolveLeaderboardShellSkipExpansionAfterManual(params: {
  prefixLimit?: number;
  manualRowCount: number;
}): boolean {
  const prefixLimit =
    params.prefixLimit != null ? Math.max(1, Math.floor(params.prefixLimit)) : undefined;
  if (prefixLimit == null) {
    return false;
  }
  return params.manualRowCount >= prefixLimit;
}

/**
 * probe 用に 1 件多く取った manual 行を prefixLimit に切り詰める。
 */
export function trimLeaderboardShellManualProbeRows<T>(params: {
  prefixLimit?: number;
  rows: readonly T[];
}): T[] {
  const prefixLimit =
    params.prefixLimit != null ? Math.max(1, Math.floor(params.prefixLimit)) : undefined;
  if (prefixLimit == null || params.rows.length <= prefixLimit) {
    return [...params.rows];
  }
  return params.rows.slice(0, prefixLimit);
}
