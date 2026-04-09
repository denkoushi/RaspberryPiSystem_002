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

/**
 * IntersectionObserver の現在値から、もっとも見えている行を選ぶ。
 * ratio が同値のときは fallbackIndex を優先して不要な揺れを避ける。
 */
export function pickBestVisibleRowIndex(
  visibilityRatios: ReadonlyMap<number, number>,
  fallbackIndex: number,
  totalRows: number
): number {
  if (totalRows <= 0) {
    return 0;
  }
  const maxIdx = totalRows - 1;
  const clampedFallback = Math.max(0, Math.min(fallbackIndex, maxIdx));
  let bestIndex = clampedFallback;
  let bestRatio = visibilityRatios.get(clampedFallback) ?? -1;

  for (const [index, ratio] of visibilityRatios.entries()) {
    if (index < 0 || index > maxIdx || ratio <= 0) {
      continue;
    }
    if (ratio > bestRatio) {
      bestIndex = index;
      bestRatio = ratio;
    }
  }

  return bestRatio > 0 ? bestIndex : clampedFallback;
}
