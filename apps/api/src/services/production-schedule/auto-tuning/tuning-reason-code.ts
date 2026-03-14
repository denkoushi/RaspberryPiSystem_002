export const DUE_MANAGEMENT_TUNING_REASON_CODES = [
  'EXPEDITE_SPECIAL_PART',
  'DELIVERY_COMMITMENT_CHANGED',
  'BOTTLENECK_AVOIDANCE',
  'QUALITY_ISSUE_RESPONSE',
  'OTHER_OPERATIONAL_REASON',
] as const;

export type DueManagementTuningReasonCode = (typeof DUE_MANAGEMENT_TUNING_REASON_CODES)[number];

const reasonCodeSet = new Set<string>(DUE_MANAGEMENT_TUNING_REASON_CODES);

export const isDueManagementTuningReasonCode = (value: unknown): value is DueManagementTuningReasonCode =>
  typeof value === 'string' && reasonCodeSet.has(value);
