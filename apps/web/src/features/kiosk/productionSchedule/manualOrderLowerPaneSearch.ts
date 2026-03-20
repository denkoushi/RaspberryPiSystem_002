import { isGrindingResourceCd } from './resourceCategory';
import { DEFAULT_SEARCH_CONDITIONS, type ProductionScheduleSearchConditions } from './searchConditions';

/** 鉛筆／資源0件リセット時に `previous` から引き継ぐ検索条件キー（追加時は下の switch に分岐を足す）。 */
export const MANUAL_ORDER_PENCIL_PRESERVED_SEARCH_FIELDS = ['activeQueries'] as const satisfies readonly (keyof ProductionScheduleSearchConditions)[];

/**
 * 鉛筆後のベース状態に、登録製番チップ選択など引き継ぎ対象フィールドだけ `previous` から上書きする。
 */
export function mergeManualOrderPencilPreservedSearchFields(
  base: ProductionScheduleSearchConditions,
  previous: ProductionScheduleSearchConditions
): ProductionScheduleSearchConditions {
  const next: ProductionScheduleSearchConditions = { ...base };
  for (const key of MANUAL_ORDER_PENCIL_PRESERVED_SEARCH_FIELDS) {
    switch (key) {
      case 'activeQueries':
        next.activeQueries = [...previous.activeQueries];
        break;
      default: {
        const _exhaustive: never = key;
        throw new Error(`Unhandled preserved field: ${String(_exhaustive)}`);
      }
    }
  }
  return next;
}

/**
 * 鉛筆で端末を選んだ直後の下ペイン条件: DEFAULT に戻したうえで先頭資源CDと工程トグルを整合させる。
 */
export function buildConditionsAfterPencilFromFirstResourceCd(resourceCd: string): ProductionScheduleSearchConditions {
  const trimmed = resourceCd.trim();
  const grinding = isGrindingResourceCd(trimmed);
  return {
    ...DEFAULT_SEARCH_CONDITIONS,
    showGrindingResources: grinding,
    showCuttingResources: !grinding,
    activeResourceCds: [trimmed]
  };
}
