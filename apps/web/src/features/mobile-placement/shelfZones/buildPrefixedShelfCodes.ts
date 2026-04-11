/**
 * プレフィックス付き棚番号を連番生成する（純関数・テスト可能）
 * 例: prefix "C", count 3 → ["C-01","C-02","C-03"]
 */
export function buildPrefixedShelfCodes(prefix: string, count: number): string[] {
  if (count < 0 || !Number.isFinite(count)) {
    return [];
  }
  const n = Math.floor(count);
  const out: string[] = [];
  for (let i = 1; i <= n; i++) {
    out.push(`${prefix}-${String(i).padStart(2, '0')}`);
  }
  return out;
}
