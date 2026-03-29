import type { PartMeasurementProcessGroup } from '@prisma/client';
import type { ProductionScheduleResourceCategory } from '@raspi-system/shared-types';
import { filterProductionScheduleResourceCdsByCategory } from '@raspi-system/shared-types';

import { ApiError } from '../../lib/errors.js';
import type { ResourceCategoryPolicy } from '../production-schedule/policies/resource-category-policy.service.js';

export type ApiProcessGroup = 'cutting' | 'grinding';

export function parseApiProcessGroup(value: string): ApiProcessGroup {
  const v = value.trim().toLowerCase();
  if (v === 'grinding') return 'grinding';
  if (v === 'cutting') return 'cutting';
  throw new ApiError(400, '工程区分が不正です', undefined, 'INVALID_PROCESS_GROUP');
}

export function apiProcessGroupToPrisma(group: ApiProcessGroup): PartMeasurementProcessGroup {
  return group === 'grinding' ? 'GRINDING' : 'CUTTING';
}

export function apiProcessGroupToResourceCategory(group: ApiProcessGroup): ProductionScheduleResourceCategory {
  return group === 'grinding' ? 'grinding' : 'cutting';
}

/**
 * 資源CDが指定工程グループに属するか（生産スケジュールの切削/研削分類と同一ルール）。
 */
export function resourceCdMatchesProcessGroup(
  resourceCd: string,
  group: ApiProcessGroup,
  policy: ResourceCategoryPolicy
): boolean {
  const category = apiProcessGroupToResourceCategory(group);
  const filtered = filterProductionScheduleResourceCdsByCategory([resourceCd], category, {
    cuttingExcludedResourceCds: policy.cuttingExcludedResourceCds
  });
  return filtered.length === 1;
}
