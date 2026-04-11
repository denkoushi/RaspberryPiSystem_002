import type { PartMeasurementScheduleRowCandidate } from '../part-measurement/part-measurement-schedule-lookup.service.js';

/** 配膳・照合で共通のトークン正規化（全角スペース等） */
export function normalizeSlipToken(value: string): string {
  return value.trim().replace(/\u3000/g, ' ');
}

/**
 * 製造order番号で引いた候補のうち、代表となる1行を返す。
 * ProductNo の winner 条件と ORDER BY は lookup 側で揃えているので先頭を採用する。
 */
export function pickPrimaryScheduleRowForOrder(
  rows: PartMeasurementScheduleRowCandidate[]
): PartMeasurementScheduleRowCandidate | null {
  return rows[0] ?? null;
}

export type SlipPairMatchInput = {
  transferOrderBarcodeRaw: string;
  transferPartBarcodeRaw: string;
  /**
   * 現品票の製造order（ProductNo）。印字のみの場合は空でよい。
   * `actualFseibanRaw` と併せて少なくとも一方が必要（ルートで検証）。
   */
  actualOrderBarcodeRaw: string;
  /**
   * 現品票の製番。製造orderが空のときに日程行解決に使う。
   */
  actualFseibanRaw: string;
  actualPartBarcodeRaw: string;
};

export type SlipPairMatchResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | 'TRANSFER_ORDER_UNRESOLVED'
        | 'ACTUAL_ORDER_UNRESOLVED'
        | 'TRANSFER_PART_MISMATCH'
        | 'ACTUAL_PART_MISMATCH'
        | 'FSEIBAN_OR_PART_PAIR_MISMATCH';
    };

/**
 * 移動票・現品票の (FSEIBAN, FHINCD) ペア一致を判定する（純関数）。
 * 呼び出し側で DB から解決した候補行を渡す。
 */
export function evaluateSlipPairMatch(params: {
  transferRow: PartMeasurementScheduleRowCandidate | null;
  actualRow: PartMeasurementScheduleRowCandidate | null;
  transferPartBarcodeRaw: string;
  actualPartBarcodeRaw: string;
}): SlipPairMatchResult {
  const { transferRow, actualRow, transferPartBarcodeRaw, actualPartBarcodeRaw } = params;

  if (!transferRow) {
    return { ok: false, reason: 'TRANSFER_ORDER_UNRESOLVED' };
  }
  if (!actualRow) {
    return { ok: false, reason: 'ACTUAL_ORDER_UNRESOLVED' };
  }

  const tPartScan = normalizeSlipToken(transferPartBarcodeRaw);
  const aPartScan = normalizeSlipToken(actualPartBarcodeRaw);
  if (tPartScan.length === 0 || aPartScan.length === 0) {
    return { ok: false, reason: 'FSEIBAN_OR_PART_PAIR_MISMATCH' };
  }

  if (transferRow.fhincd.trim().toUpperCase() !== tPartScan.toUpperCase()) {
    return { ok: false, reason: 'TRANSFER_PART_MISMATCH' };
  }
  if (actualRow.fhincd.trim().toUpperCase() !== aPartScan.toUpperCase()) {
    return { ok: false, reason: 'ACTUAL_PART_MISMATCH' };
  }

  const tFs = transferRow.fseiban.trim().toUpperCase();
  const aFs = actualRow.fseiban.trim().toUpperCase();
  if (tFs.length === 0 || aFs.length === 0 || tFs !== aFs) {
    return { ok: false, reason: 'FSEIBAN_OR_PART_PAIR_MISMATCH' };
  }

  if (tPartScan.toUpperCase() !== aPartScan.toUpperCase()) {
    return { ok: false, reason: 'FSEIBAN_OR_PART_PAIR_MISMATCH' };
  }

  return { ok: true };
}
