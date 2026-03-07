export type TriageZone = 'danger' | 'caution' | 'safe';

export type TriageZoneInput = {
  daysUntilDue: number | null;
  partsCount: number;
  processCount: number;
};

const DANGER_DAYS_THRESHOLD = 1;
const CAUTION_DAYS_THRESHOLD = 3;
const HIGH_PARTS_THRESHOLD = 20;
const HIGH_PROCESS_THRESHOLD = 40;

const clampToTriageZone = (level: number): TriageZone => {
  if (level <= 0) return 'danger';
  if (level === 1) return 'caution';
  return 'safe';
};

export function classifyTriageZone(input: TriageZoneInput): TriageZone {
  let level: number;
  if (input.daysUntilDue === null) {
    // 納期未設定は運用上の見落としリスクがあるため注意扱い。
    level = 1;
  } else if (input.daysUntilDue <= DANGER_DAYS_THRESHOLD) {
    level = 0;
  } else if (input.daysUntilDue <= CAUTION_DAYS_THRESHOLD) {
    level = 1;
  } else {
    level = 2;
  }

  const hasLargeRemainingWork = input.partsCount >= HIGH_PARTS_THRESHOLD || input.processCount >= HIGH_PROCESS_THRESHOLD;
  if (hasLargeRemainingWork) {
    level -= 1;
  }

  return clampToTriageZone(level);
}
