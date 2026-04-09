import { useQuery } from '@tanstack/react-query';

import { getItemLoanAnalytics } from '../../api/client';

export function useItemLoanAnalytics() {
  return useQuery({
    queryKey: ['item-loan-analytics'],
    queryFn: () => getItemLoanAnalytics(),
    staleTime: 60_000
  });
}
