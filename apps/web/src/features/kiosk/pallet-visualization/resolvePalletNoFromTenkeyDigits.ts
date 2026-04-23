export type TenkeyPalletResolveResult =
  | { ok: true; value: number }
  | { ok: false; message: string };

/**
 * テンキー 1〜2 桁からパレット番号を解決する。
 * - 1 桁: 1〜9 のみ有効（0 単独は不可）
 * - 2 桁: 数値 10*a+b が 1..max に含まれること（例: 01→1, 10→10）
 */
export function resolvePalletNoFromTenkeyDigits(
  digits: readonly number[],
  maxPallet: number
): TenkeyPalletResolveResult {
  if (digits.length === 0) {
    return { ok: false, message: 'パレット番号をテンキーで入力してからスキャンしてください' };
  }
  if (digits.length > 2) {
    return { ok: false, message: 'パレット番号は1〜2桁です' };
  }
  if (digits.some((d) => d < 0 || d > 9 || !Number.isInteger(d))) {
    return { ok: false, message: 'パレット番号が不正です' };
  }
  let value: number;
  if (digits.length === 1) {
    value = digits[0] ?? 0;
    if (value < 1) {
      return { ok: false, message: '1桁のときは1〜9を押してください' };
    }
  } else {
    const a = digits[0] ?? 0;
    const b = digits[1] ?? 0;
    value = a * 10 + b;
  }
  if (value < 1 || value > maxPallet) {
    return { ok: false, message: `パレット番号は1〜${maxPallet}です` };
  }
  return { ok: true, value };
}
