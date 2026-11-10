import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { toolsQueryKeys } from '../../../../api/queryKeys/tools';

import { loanOutboxRunner } from './loanOutboxRunner';

export function useLoanOutboxReplay() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const off = loanOutboxRunner.onSent(() => {
      void queryClient.invalidateQueries({ queryKey: toolsQueryKeys.loansAll });
    });
    const flush = () => {
      void loanOutboxRunner.flush().catch(error => console.warn('Loan offline replay failed', error));
    };
    flush();
    const timer = window.setInterval(flush, 30_000);
    window.addEventListener('online', flush);
    return () => {
      off();
      window.clearInterval(timer);
      window.removeEventListener('online', flush);
    };
  }, [queryClient]);
}
