/** 製造order番号（ProductNo）の桁数。CSV取り込み時に `/^\d{10}$/` を強制している。 */
export const MANUFACTURING_ORDER_DIGIT_LENGTH = 10;

/**
 * 移動票スキャン値を製造order番号へ正規化する。
 * スキャナ設定により前後へ記号が付くことがあるため、全角数字を半角にしてから数字以外を除去する。
 * 残りが10桁でなければ `null` を返す（空振り検索より読み直しを促すため）。
 */
export function normalizeManufacturingOrderScanText(value: string): string | null {
  const digits = value.normalize('NFKC').replace(/\D/g, '');
  return digits.length === MANUFACTURING_ORDER_DIGIT_LENGTH ? digits : null;
}
