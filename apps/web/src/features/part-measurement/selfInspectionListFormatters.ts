import { formatKioskDateTime } from './formatKioskPartMeasurementDraftUpdatedAt';

/**
 * Formats a self-inspection timestamp for the kiosk list.
 *
 * The list deliberately stops at minutes: seconds do not help operators pick
 * the next item and make otherwise identical rows harder to scan. Invalid or
 * legacy-missing timestamps stay explicit rather than falling back to another
 * date field.
 */
export const formatSelfInspectionDateTime = formatKioskDateTime;

/** Backwards-compatible short name for callers that already use formatDateTime. */
export const formatDateTime = formatSelfInspectionDateTime;

export function formatSelfInspectionResourceLabel(
  resourceCd: string | null | undefined,
  resourceNameMap: Record<string, readonly string[] | undefined>
): string {
  const code = resourceCd?.trim() ?? '';
  const names = code
    ? (resourceNameMap[code] ?? []).map((name) => name.trim()).filter(Boolean)
    : [];
  if (names.length > 0) return `${names.join(' / ')}（${code}）`;
  return code || '—';
}

export function formatSelfInspectionParticipantLabel(names: readonly string[] | null | undefined): string {
  const normalized = (names ?? []).map((name) => name.trim()).filter(Boolean);
  return normalized.length > 0 ? normalized.join(' / ') : '—';
}
