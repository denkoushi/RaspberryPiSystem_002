import type { ProductionScheduleResourceNameMap } from '../production-schedule/resource-master.service.js';

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').trim();
}

function normalizeResourceCd(value: string | null | undefined): string {
  return normalizeText(value).toUpperCase();
}

/** 資源マスタの複数名を、サイネージ用の安定した1表示名へ変換する。 */
export function resolveSelfInspectionMachineBoardResourceDisplayName(
  resourceCd: string,
  resourceNameMap: ProductionScheduleResourceNameMap | undefined
): string {
  const normalizedResourceCd = normalizeResourceCd(resourceCd);
  const names = (resourceNameMap?.[normalizedResourceCd] ?? [])
    .map((name) => normalizeText(name))
    .filter((name, index, values) => name.length > 0 && values.indexOf(name) === index);
  return names.length > 0 ? names.join(' / ') : '名称未登録';
}
