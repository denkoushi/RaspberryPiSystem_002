import { useQuery } from '@tanstack/react-query';

import { getRiggingLoanAnalytics } from '../../api/client';
import { riggingQueryKeys } from '../../api/queryKeys/rigging';

type LoanAnalyticsQueryParams = {
  periodFrom?: string;
  periodTo?: string;
  monthlyMonths?: number;
  timeZone?: 'Asia/Tokyo' | 'UTC';
  riggingGearId?: string;
};

export function useRiggingLoanAnalytics(params?: LoanAnalyticsQueryParams) {
  return useQuery({
    queryKey: riggingQueryKeys.loanAnalytics(params),
    queryFn: () => getRiggingLoanAnalytics(params),
    staleTime: 60_000
  });
}
