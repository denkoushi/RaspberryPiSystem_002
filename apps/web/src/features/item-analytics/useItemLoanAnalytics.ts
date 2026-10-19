import { useQuery } from '@tanstack/react-query';

import { getItemLoanAnalytics } from '../../api/client';
import { reportsQueryKeys } from '../../api/queryKeys/reports';

type LoanAnalyticsQueryParams = {
  periodFrom?: string;
  periodTo?: string;
  monthlyMonths?: number;
  timeZone?: 'Asia/Tokyo' | 'UTC';
  itemId?: string;
};

export function useItemLoanAnalytics(params?: LoanAnalyticsQueryParams) {
  return useQuery({
    queryKey: reportsQueryKeys.itemLoanAnalytics(params),
    queryFn: () => getItemLoanAnalytics(params),
    staleTime: 60_000
  });
}
