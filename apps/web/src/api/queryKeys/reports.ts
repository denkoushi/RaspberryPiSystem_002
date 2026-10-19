import type { LoanReportPreviewQuery } from '../backup';
import type { getItemLoanAnalytics } from '../client';

export const reportsQueryKeys = {
  loanReportPreview: (params: LoanReportPreviewQuery) => ['loan-report-preview', params] as const,
  itemLoanAnalytics: (params?: Parameters<typeof getItemLoanAnalytics>[0]) =>
    ['item-loan-analytics', params ?? {}] as const,
};
