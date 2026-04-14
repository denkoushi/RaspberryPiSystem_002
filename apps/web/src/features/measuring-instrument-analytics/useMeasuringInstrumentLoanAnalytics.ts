import { useQuery } from '@tanstack/react-query';

import { getMeasuringInstrumentLoanAnalytics } from '../../api/client';

type LoanAnalyticsQueryParams = {
  periodFrom?: string;
  periodTo?: string;
  monthlyMonths?: number;
  timeZone?: 'Asia/Tokyo' | 'UTC';
  measuringInstrumentId?: string;
};

export function useMeasuringInstrumentLoanAnalytics(params?: LoanAnalyticsQueryParams) {
  return useQuery({
    queryKey: ['measuring-instrument-loan-analytics', params ?? {}],
    queryFn: () => getMeasuringInstrumentLoanAnalytics(params),
    staleTime: 60_000,
  });
}
