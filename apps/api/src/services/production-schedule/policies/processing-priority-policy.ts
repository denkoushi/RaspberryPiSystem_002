export const PROCESSING_TYPE_PRIORITY = ['LSLH', 'カニゼン', '塗装', 'その他01', 'その他02'] as const;

const processingPriorityMap = new Map<string, number>(
  PROCESSING_TYPE_PRIORITY.map((value, index) => [value, index + 1])
);

export function getProcessingTypePriority(processingType: string | null | undefined): number {
  const normalized = typeof processingType === 'string' ? processingType.trim() : '';
  if (normalized.length === 0) {
    return PROCESSING_TYPE_PRIORITY.length + 1;
  }
  return processingPriorityMap.get(normalized) ?? PROCESSING_TYPE_PRIORITY.length + 1;
}

export function compareProcessingTypePriority(a: string | null | undefined, b: string | null | undefined): number {
  return getProcessingTypePriority(a) - getProcessingTypePriority(b);
}
