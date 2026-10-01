import { parseFkojunstStatusMailFupdteDt } from '../csv-dashboard/fkojunst-status-mail-fupdtedt-parse.js';
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
  /** `FKOBAIST`（大文字化済み）。列が無いCSV・空欄は null */
  purchaseStatus: string | null;
  /** `FUPDTEDT`（元システムの更新日時、JST 壁時計）。列が無いCSV・空欄・解釈不能は null */
  sourceUpdatedAt: Date | null;
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
  const purchaseStatus = normalizeToken(rowData.FKOBAIST).toUpperCase().slice(0, 8) || null;
  return {
    purchaseOrderNo,
    purchasePartCodeRaw,
    purchasePartCodeNormalized,
    purchasePartCodeMatchKey,
    seiban,
    purchasePartName,
    acceptedQuantity,
    purchaseStatus,
    sourceUpdatedAt: parseFkojunstStatusMailFupdteDt(rowData.FUPDTEDT),
    lineIndex,
  };
}

/**
 * 同じキーの2行のうち `next` を採るか。更新日時が新しい方を採り、同時刻・両方不明なら後の行を採る。
 * 更新日時が不明な行は、更新日時のある行を置き換えない。
 */
export function shouldReplacePurchaseOrderLookupRow(
  current: Pick<ParsedPurchaseOrderLookupCsvRow, 'sourceUpdatedAt'>,
  next: Pick<ParsedPurchaseOrderLookupCsvRow, 'sourceUpdatedAt'>
): boolean {
  if (current.sourceUpdatedAt == null) return true;
  if (next.sourceUpdatedAt == null) return false;
  return next.sourceUpdatedAt.getTime() >= current.sourceUpdatedAt.getTime();
}
