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
  transferFhinmeiBarcodeRaw: string;
  actualOrderBarcodeRaw: string;
  actualFhinmeiBarcodeRaw: string;
};

export type SlipPairMatchResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | 'TRANSFER_ORDER_UNRESOLVED'
        | 'ACTUAL_ORDER_UNRESOLVED'
        | 'TRANSFER_FHINMEI_MISMATCH'
        | 'ACTUAL_FHINMEI_MISMATCH'
        | 'FSEIBAN_OR_FHINMEI_PAIR_MISMATCH';
    };

/**
 * 移動票・現品票の (FSEIBAN, FHINMEI) ペア一致を判定する（純関数）。
 * 呼び出し側で DB から解決した候補行を渡す。
 */
export function evaluateSlipPairMatch(params: {
  transferRow: PartMeasurementScheduleRowCandidate | null;
  actualRow: PartMeasurementScheduleRowCandidate | null;
  transferFhinmeiBarcodeRaw: string;
  actualFhinmeiBarcodeRaw: string;
}): SlipPairMatchResult {
  const { transferRow, actualRow, transferFhinmeiBarcodeRaw, actualFhinmeiBarcodeRaw } = params;

  if (!transferRow) {
    return { ok: false, reason: 'TRANSFER_ORDER_UNRESOLVED' };
  }
  if (!actualRow) {
    return { ok: false, reason: 'ACTUAL_ORDER_UNRESOLVED' };
  }

  const tFhinmeiScan = normalizeSlipToken(transferFhinmeiBarcodeRaw);
  const aFhinmeiScan = normalizeSlipToken(actualFhinmeiBarcodeRaw);
  if (tFhinmeiScan.length === 0 || aFhinmeiScan.length === 0) {
    return { ok: false, reason: 'FSEIBAN_OR_FHINMEI_PAIR_MISMATCH' };
  }

  if (transferRow.fhinmei.trim().toUpperCase() !== tFhinmeiScan.toUpperCase()) {
    return { ok: false, reason: 'TRANSFER_FHINMEI_MISMATCH' };
  }
  if (actualRow.fhinmei.trim().toUpperCase() !== aFhinmeiScan.toUpperCase()) {
    return { ok: false, reason: 'ACTUAL_FHINMEI_MISMATCH' };
  }

  const tFs = transferRow.fseiban.trim().toUpperCase();
  const aFs = actualRow.fseiban.trim().toUpperCase();
  if (tFs.length === 0 || aFs.length === 0 || tFs !== aFs) {
    return { ok: false, reason: 'FSEIBAN_OR_FHINMEI_PAIR_MISMATCH' };
  }

  if (tFhinmeiScan.toUpperCase() !== aFhinmeiScan.toUpperCase()) {
    return { ok: false, reason: 'FSEIBAN_OR_FHINMEI_PAIR_MISMATCH' };
  }

  return { ok: true };
}
