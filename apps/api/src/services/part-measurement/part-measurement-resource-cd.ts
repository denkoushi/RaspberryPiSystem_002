import { PART_MEASUREMENT_LEGACY_RESOURCE_CD } from './part-measurement-constants.js';

export function normalizePartMeasurementResourceCd(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : PART_MEASUREMENT_LEGACY_RESOURCE_CD;
}
