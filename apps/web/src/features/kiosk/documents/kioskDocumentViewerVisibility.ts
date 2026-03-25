/**
 * 要領書ビューア: アクティブ行を中心に前後 radius 行の画像をマウントする（純関数・テスト対象）
 */
export function computeNearVisibleIndices(
  activeIndex: number,
  totalRows: number,
  radius: number
): Set<number> {
  const set = new Set<number>();
  if (totalRows <= 0 || radius < 0) {
    return set;
  }
  const clampedActive = Math.max(0, Math.min(activeIndex, totalRows - 1));
  const from = Math.max(0, clampedActive - radius);
  const to = Math.min(totalRows - 1, clampedActive + radius);
  for (let i = from; i <= to; i += 1) {
    set.add(i);
  }
  return set;
}
