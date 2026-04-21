import { normalizePurchaseFhinCdForMatching, normalizePurchaseFhinCdForScheduleLookup } from './purchase-fhincd-normalize.js';

const normalizeToken = (value: unknown): string => String(value ?? '').trim();

export type ParsedPurchaseOrderLookupCsvRow = {
  purchaseOrderNo: string;
  purchasePartCodeRaw: string;
  /** 括弧除去のみ（従来列・表示互換） */
  purchasePartCodeNormalized: string;
  /** 生産日程 `FHINCD` との照合キー（括弧除去 + 末尾数値枝番除去） */
  purchasePartCodeMatchKey: string;
  seiban: string;
  purchasePartName: string;
  acceptedQuantity: number;
  lineIndex: number;
};

/** 購買ナンバー（製造order番号と同桁想定の10桁数字） */
const PURCHASE_ORDER_NO_PATTERN = /^\d{10}$/;

/**
 * CsvDashboardRow.rowData から購買照会用の1行を取り出す。無効行は null。
 */
export function parsePurchaseOrderLookupRow(
  rowData: Record<string, unknown>,
  lineIndex: number
): ParsedPurchaseOrderLookupCsvRow | null {
  const purchaseOrderNo = normalizeToken(rowData.FKOBAINO);
  if (!PURCHASE_ORDER_NO_PATTERN.test(purchaseOrderNo)) {
    return null;
  }
  const purchasePartCodeRaw = normalizeToken(rowData.FHINCD);
  const seiban = normalizeToken(rowData.FSEIBAN);
  const purchasePartName = normalizeToken(rowData.FKOBAIHINMEI);
  const purchasePartCodeNormalized = normalizePurchaseFhinCdForScheduleLookup(purchasePartCodeRaw);
  const purchasePartCodeMatchKey = normalizePurchaseFhinCdForMatching(purchasePartCodeRaw);
  const qtyRaw = normalizeToken(rowData.FKENSAOKSU);
  let acceptedQuantity = 0;
  if (qtyRaw.length > 0) {
    const n = Number.parseInt(qtyRaw, 10);
    acceptedQuantity = Number.isFinite(n) ? n : 0;
  }
  return {
    purchaseOrderNo,
    purchasePartCodeRaw,
    purchasePartCodeNormalized,
    purchasePartCodeMatchKey,
    seiban,
    purchasePartName,
    acceptedQuantity,
    lineIndex,
  };
}
