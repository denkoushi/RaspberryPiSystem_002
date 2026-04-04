import type { PartMeasurementTemplateMatchKind } from '../types';

/**
 * 記録表の resourceCdSnapshot は日程どおり。テンプレの資源が異なる借用には API で明示フラグが必要。
 */
export function allowAlternateResourceForMatchKind(kind: PartMeasurementTemplateMatchKind): boolean {
  return kind === 'same_fhincd_other_resource';
}
