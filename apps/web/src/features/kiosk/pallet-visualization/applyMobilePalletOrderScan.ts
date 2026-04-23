import { resolvePalletNoFromTenkeyDigits } from './resolvePalletNoFromTenkeyDigits';

export type ApplyMobilePalletOrderScanDeps = {
  /** 未選択時は null。1 未満ならエラー */
  palletCount: number | null | undefined;
  setPalletNo: (n: number) => void;
  addBarcodeToPallet: (raw: string, palletNoOverride: number) => void;
};

export type ApplyMobilePalletOrderScanResult = { ok: true } | { ok: false; message: string };

/**
 * 製造 order バーコード確定時: 桁バッファからパレット番号を解決し、API へ追加する手順。
 */
export function applyMobilePalletOrderScan(
  barcodeText: string,
  digits: readonly number[],
  deps: ApplyMobilePalletOrderScanDeps
): ApplyMobilePalletOrderScanResult {
  const palletCount = deps.palletCount;
  if (palletCount == null || palletCount < 1) {
    return { ok: false, message: '加工機を選択してください' };
  }
  const resolved = resolvePalletNoFromTenkeyDigits(digits, palletCount);
  if (!resolved.ok) {
    return { ok: false, message: resolved.message };
  }
  deps.setPalletNo(resolved.value);
  deps.addBarcodeToPallet(barcodeText.trim(), resolved.value);
  return { ok: true };
}
