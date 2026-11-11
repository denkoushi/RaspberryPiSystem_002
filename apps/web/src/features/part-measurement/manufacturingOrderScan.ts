/** 製造order番号（ProductNo）の桁数。CSV取り込み時に `/^\d{10}$/` を強制している。 */
export const MANUFACTURING_ORDER_DIGIT_LENGTH = 10;

/**
 * 移動票スキャン値を製造order番号へ正規化する。
 * スキャナ設定や読み間違いで前後へ記号や余分な文字が付くことがあるため、全角数字を半角にしてから、
 * 記号などで区切られたちょうど10桁の数字の並びが1つだけあればそれを使う（例: `0004151384$200%`）。
 * 無ければ従来どおり数字以外を除去し、残りが10桁でなければ `null` を返す（空振り検索より読み直しを促すため）。
 */
export function normalizeManufacturingOrderScanText(value: string): string | null {
  const text = value.normalize('NFKC');
  const exactRuns = (text.match(/\d+/g) ?? []).filter((run) => run.length === MANUFACTURING_ORDER_DIGIT_LENGTH);
  if (exactRuns.length === 1) return exactRuns[0];
  if (exactRuns.length > 1) return null;
  const digits = text.replace(/\D/g, '');
  return digits.length === MANUFACTURING_ORDER_DIGIT_LENGTH ? digits : null;
}
