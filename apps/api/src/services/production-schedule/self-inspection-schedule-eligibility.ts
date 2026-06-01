import type { Prisma } from '@prisma/client';

/** 補助テーブル `plannedQuantity` を自主検査の指示数として解釈する（欠損・0以下は不明） */
export function resolveProductionSchedulePlannedQuantity(
  plannedQuantity: number | null | undefined
): number | null {
  if (typeof plannedQuantity !== 'number' || !Number.isFinite(plannedQuantity)) {
    return null;
  }
  const normalized = Math.floor(plannedQuantity);
  return normalized >= 1 ? normalized : null;
}

/** テキストのみ検索時の最小文字数（1 文字ごとの走査を避ける） */
export const SELF_INSPECTION_CANDIDATE_MIN_QUERY_TEXT_LENGTH = 2;

export function hasSelfInspectionCandidateListFilters(params: {
  queryText?: string;
  resourceCds?: string[];
  productNos?: string[];
}): boolean {
  const queryText = (params.queryText ?? '').trim();
  const hasResourceCds = (params.resourceCds ?? []).some((value) => value.trim().length > 0);
  if (hasResourceCds) {
    return true;
  }
  if (params.productNos?.some((value) => value.trim().length > 0)) {
    return true;
  }
  return queryText.length >= SELF_INSPECTION_CANDIDATE_MIN_QUERY_TEXT_LENGTH;
}

export type SelfInspectionScheduleEligibilityRow = {
  rowData: Prisma.JsonValue;
  plannedQuantity?: number | null;
  partMeasurementProcessGroup?: 'cutting' | 'grinding';
  selfInspectionEntryPath?: string | null;
};

export function isSelfInspectionEligibleProductionScheduleRow(
  row: SelfInspectionScheduleEligibilityRow
): boolean {
  const entryPath = row.selfInspectionEntryPath?.trim() ?? '';
  if (!entryPath || !row.partMeasurementProcessGroup) {
    return false;
  }
  const rowData = (row.rowData ?? {}) as Record<string, unknown>;
  const productNo = String(rowData.ProductNo ?? '').trim();
  const resourceCd = String(rowData.FSIGENCD ?? '').trim();
  const fhincd = String(rowData.FHINCD ?? '').trim();
  const fhinmei = String(rowData.FHINMEI ?? '').trim();
  const fseiban = String(rowData.FSEIBAN ?? '').trim();
  return Boolean(productNo && resourceCd && fhincd && fhinmei && fseiban);
}

export function filterSelfInspectionEligibleProductionScheduleRows<T extends SelfInspectionScheduleEligibilityRow>(
  rows: T[]
): T[] {
  return rows.filter(isSelfInspectionEligibleProductionScheduleRow);
}
