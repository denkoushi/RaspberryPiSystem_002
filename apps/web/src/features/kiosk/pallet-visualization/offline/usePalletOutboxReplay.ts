import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { palletOutboxRunner } from './palletOutboxRunner';

export function usePalletOutboxReplay() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const off = palletOutboxRunner.onSent(() => {
      void queryClient.invalidateQueries({ queryKey: ['kiosk-pallet-viz-board'] });
    });
    const flush = () => {
      void palletOutboxRunner.flush().catch(error => console.warn('Pallet offline replay failed', error));
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
