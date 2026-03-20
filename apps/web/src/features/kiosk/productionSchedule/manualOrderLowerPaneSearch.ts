import { isGrindingResourceCd } from './resourceCategory';
import { DEFAULT_SEARCH_CONDITIONS, type ProductionScheduleSearchConditions } from './searchConditions';

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
