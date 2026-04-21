/**
 * ZXing 連続デコードの揺れ対策: 同一値が短時間に複回観測されたときだけ確定する。
 * 純関数でテスト可能にし、セッション層から分離する。
 */

export type BarcodeStabilityState = {
  value: string;
  consecutiveHits: number;
  lastHitAtMs: number;
};

export type BarcodeStabilityConfig = {
  /** 確定に必要な連続ヒット数（同一 value が時間窓内で何回続いたか） */
  requiredConsecutiveHits: number;
  /** 前回ヒットからこの ms を超えると連続カウントをリセット */
  stableWindowMs: number;
};

export const DEFAULT_BARCODE_STABILITY: BarcodeStabilityConfig = {
  requiredConsecutiveHits: 2,
  stableWindowMs: 600,
};

/**
 * 新しいデコード結果を反映し、確定すべきかを返す。
 */
export function reduceBarcodeStability(
  prev: BarcodeStabilityState | null,
  text: string,
  nowMs: number,
  config: BarcodeStabilityConfig
): { next: BarcodeStabilityState | null; shouldConfirm: boolean } {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return { next: prev, shouldConfirm: false };
  }

  const withinWindow =
    prev != null &&
    prev.value === trimmed &&
    nowMs - prev.lastHitAtMs <= config.stableWindowMs;

  const consecutiveHits = withinWindow ? prev.consecutiveHits + 1 : 1;
  const next: BarcodeStabilityState = {
    value: trimmed,
    consecutiveHits,
    lastHitAtMs: nowMs,
  };

  return {
    next,
    shouldConfirm: consecutiveHits >= config.requiredConsecutiveHits,
  };
}
