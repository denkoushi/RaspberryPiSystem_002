/**
 * PostgreSQL の prepared statement に載せられるバインド変数数の実用上の上限。
 * 典型値 32767（サーバ / ドライバ依存。超過例: `too many bind variables … received …`）。
 */
export const POSTGRES_PREPARED_STATEMENT_MAX_BIND_PARAMS = 32767;

/**
 * タプル IN（例: 複合3キーで `(a,b,c) IN (($1,$2,$3),…)`）など、
 * 1クエリあたりのバインド数が「固定分 + paramsPerTuple * N」のとき、
 * 安全に載せうるタプル数 N の上限。
 */
export function maxTuplePlaceholdersPerQuery(paramsPerTuple: number, fixedBindCount: number): number {
  const p = Math.max(1, Math.floor(paramsPerTuple));
  const fixed = Math.max(0, Math.floor(fixedBindCount));
  const headroom = POSTGRES_PREPARED_STATEMENT_MAX_BIND_PARAMS - fixed;
  if (headroom < p) {
    return 1;
  }
  return Math.floor(headroom / p);
}
