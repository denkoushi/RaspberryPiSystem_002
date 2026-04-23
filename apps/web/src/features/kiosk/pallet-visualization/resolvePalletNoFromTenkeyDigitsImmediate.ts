/**
 * テンキー桁バッファから、即時に反映するパレット番号を解決する（1〜99・max クランプなしで無効は null）。
 * - 0 桁: 変更なし（null）
 * - 1 桁: 1〜9 のみ（0 単独は null）
 * - 2 桁: 10a+b が 1..max に入るときのみ
 * - 3 桁以上: 先頭 2 桁のみ解釈（通常バッファは最大 2 桁）
 */
export function resolvePalletNoFromTenkeyDigitsImmediate(
  digits: readonly number[],
  maxPallet: number
): number | null {
  if (digits.length === 0) return null;
  if (digits.some((d) => d < 0 || d > 9 || !Number.isInteger(d))) return null;

  const take = digits.length >= 3 ? digits.slice(0, 2) : digits;

  if (take.length === 1) {
    const v = take[0] ?? 0;
    if (v < 1) return null;
    return v <= maxPallet ? v : null;
  }

  const a = take[0] ?? 0;
  const b = take[1] ?? 0;
  const v = a * 10 + b;
  if (v < 1 || v > maxPallet) return null;
  return v;
}
