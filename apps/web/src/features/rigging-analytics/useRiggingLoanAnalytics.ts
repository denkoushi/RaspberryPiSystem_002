import { useQuery } from '@tanstack/react-query';

import { getRiggingLoanAnalytics } from '../../api/client';

export function useRiggingLoanAnalytics() {
  return useQuery({
    queryKey: ['rigging-loan-analytics'],
    queryFn: () => getRiggingLoanAnalytics(),
    staleTime: 60_000
  });
}
