import { useQuery } from '@tanstack/react-query';

import { getMeasuringInstrumentLoanAnalytics } from '../../api/client';
import { measuringInstrumentsQueryKeys } from '../../api/queryKeys/measuringInstruments';

type LoanAnalyticsQueryParams = {
  periodFrom?: string;
  periodTo?: string;
  monthlyMonths?: number;
  timeZone?: 'Asia/Tokyo' | 'UTC';
  measuringInstrumentId?: string;
};

export function useMeasuringInstrumentLoanAnalytics(params?: LoanAnalyticsQueryParams) {
  return useQuery({
    queryKey: measuringInstrumentsQueryKeys.loanAnalytics(params),
    queryFn: () => getMeasuringInstrumentLoanAnalytics(params),
    staleTime: 60_000,
  });
}
