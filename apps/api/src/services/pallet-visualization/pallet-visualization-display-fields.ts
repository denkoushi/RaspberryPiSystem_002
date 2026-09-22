import { machineTypeDisplayKey } from '../signage/mobile-placement-parts-shelf/normalizers.js';
import { normalizeOutsideDimensionsDisplay } from '../production-schedule/production-schedule-snapshot-fields.js';

// Compatibility exports for existing callers; production schedule owns the CSV field interpretation.
export {
  extractOutsideDimensionsDisplay,
  normalizeOutsideDimensionsDisplay,
} from '../production-schedule/production-schedule-snapshot-fields.js';

/** 着手日（DB Date）を YYYY-MM-DD で返す。 */
export function formatPlannedStartDateForPalletDisplay(date: Date | null | undefined): string | null {
  if (!date) return null;
  return date.toISOString().slice(0, 10);
}

/** パレットカード用: 機種名を半角大文字・第1ハイフン前・先頭10コードポイントに揃える。 */
export function buildPalletMachineNameDisplay(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (trimmed.length === 0) return null;
  const key = machineTypeDisplayKey(trimmed);
  return key.length > 0 ? key : null;
}

export type PalletItemScheduleSnapshotAugment = {
  plannedQuantity: number | null;
  plannedStartDateDisplay: string | null;
  outsideDimensionsDisplay: string | null;
};

export function readPalletItemDisplayFromScheduleSnapshot(snapshot: unknown): PalletItemScheduleSnapshotAugment {
  if (snapshot == null || typeof snapshot !== 'object') {
    return { plannedQuantity: null, plannedStartDateDisplay: null, outsideDimensionsDisplay: null };
  }
  const s = snapshot as Record<string, unknown>;
  const plannedQuantity =
    typeof s.plannedQuantity === 'number' && Number.isFinite(s.plannedQuantity) ? s.plannedQuantity : null;
  const plannedStartDateDisplay =
    typeof s.plannedStartDateDisplay === 'string' && s.plannedStartDateDisplay.trim().length > 0
      ? s.plannedStartDateDisplay.trim()
      : null;
  const outsideDimensionsDisplay =
    typeof s.outsideDimensionsDisplay === 'string' && s.outsideDimensionsDisplay.trim().length > 0
      ? normalizeOutsideDimensionsDisplay(s.outsideDimensionsDisplay)
      : null;
  return { plannedQuantity, plannedStartDateDisplay, outsideDimensionsDisplay };
}
