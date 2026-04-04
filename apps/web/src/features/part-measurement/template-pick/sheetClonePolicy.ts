import type { PartMeasurementTemplateMatchKind } from '../types';

/**
 * `exact_resource` は既に日程の3要素キーに紐づくテンプレ。その他は API 複製後に記録表を開始する。
 */
export function shouldCloneTemplateBeforeSheet(kind: PartMeasurementTemplateMatchKind): boolean {
  return kind !== 'exact_resource';
}
