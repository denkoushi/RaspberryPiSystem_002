import { useQuery } from '@tanstack/react-query';

import { getItemLoanAnalytics } from '../../api/client';

type LoanAnalyticsQueryParams = {
  periodFrom?: string;
  periodTo?: string;
  monthlyMonths?: number;
  timeZone?: 'Asia/Tokyo' | 'UTC';
  itemId?: string;
};

export function useItemLoanAnalytics(params?: LoanAnalyticsQueryParams) {
  return useQuery({
    queryKey: ['item-loan-analytics', params ?? {}],
    queryFn: () => getItemLoanAnalytics(params),
    staleTime: 60_000
  });
}
