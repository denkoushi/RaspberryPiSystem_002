import { useQuery } from '@tanstack/react-query';

import { getRiggingLoanAnalytics } from '../../api/client';

type LoanAnalyticsQueryParams = {
  periodFrom?: string;
  periodTo?: string;
  monthlyMonths?: number;
  timeZone?: 'Asia/Tokyo' | 'UTC';
};

export function useRiggingLoanAnalytics(params?: LoanAnalyticsQueryParams) {
  return useQuery({
    queryKey: ['rigging-loan-analytics', params ?? {}],
    queryFn: () => getRiggingLoanAnalytics(params),
    staleTime: 60_000
  });
}
