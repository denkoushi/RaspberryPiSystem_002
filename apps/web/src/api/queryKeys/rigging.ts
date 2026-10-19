import type { getRiggingGears, getRiggingLoanAnalytics } from '../client';

export const riggingQueryKeys = {
  gearsAll: ['rigging-gears'] as const,
  gears: (params?: Parameters<typeof getRiggingGears>[0]) => ['rigging-gears', params] as const,
  inspectionRecords: (riggingGearId?: string) => ['rigging-inspection-records', riggingGearId] as const,
  loanAnalytics: (params?: Parameters<typeof getRiggingLoanAnalytics>[0]) =>
    ['rigging-loan-analytics', params ?? {}] as const,
};
