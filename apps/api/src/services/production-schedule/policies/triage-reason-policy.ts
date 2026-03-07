export type TriageReasonCode =
  | 'DUE_DATE_MISSING'
  | 'DUE_DATE_OVERDUE'
  | 'DUE_DATE_TODAY'
  | 'DUE_DATE_TOMORROW'
  | 'DUE_DATE_SOON'
  | 'LARGE_PART_COUNT'
  | 'LARGE_PROCESS_COUNT'
  | 'SURFACE_PRIORITY';

export type TriageReason = {
  code: TriageReasonCode;
  message: string;
};

export type TriageReasonInput = {
  dueDateText: string | null;
  daysUntilDue: number | null;
  partsCount: number;
  processCount: number;
  topProcessingType: string | null;
};

const HIGH_PARTS_THRESHOLD = 20;
const HIGH_PROCESS_THRESHOLD = 40;

export function buildTriageReasons(input: TriageReasonInput): TriageReason[] {
  const reasons: TriageReason[] = [];

  if (!input.dueDateText) {
    reasons.push({
      code: 'DUE_DATE_MISSING',
      message: '納期日が未設定です'
    });
  } else if (input.daysUntilDue !== null) {
    if (input.daysUntilDue < 0) {
      reasons.push({
        code: 'DUE_DATE_OVERDUE',
        message: '納期日を超過しています'
      });
    } else if (input.daysUntilDue === 0) {
      reasons.push({
        code: 'DUE_DATE_TODAY',
        message: '納期日が今日です'
      });
    } else if (input.daysUntilDue === 1) {
      reasons.push({
        code: 'DUE_DATE_TOMORROW',
        message: '納期日が明日です'
      });
    } else if (input.daysUntilDue <= 3) {
      reasons.push({
        code: 'DUE_DATE_SOON',
        message: '納期日が3日以内です'
      });
    }
  }

  if (input.partsCount >= HIGH_PARTS_THRESHOLD) {
    reasons.push({
      code: 'LARGE_PART_COUNT',
      message: `未完了部品が多いです（${input.partsCount}件）`
    });
  }

  if (input.processCount >= HIGH_PROCESS_THRESHOLD) {
    reasons.push({
      code: 'LARGE_PROCESS_COUNT',
      message: `未完了工程が多いです（${input.processCount}件）`
    });
  }

  if (input.topProcessingType === 'LSLH' || input.topProcessingType === 'カニゼン' || input.topProcessingType === '塗装') {
    reasons.push({
      code: 'SURFACE_PRIORITY',
      message: `表面処理優先ルール対象（${input.topProcessingType}）`
    });
  }

  return reasons;
}
