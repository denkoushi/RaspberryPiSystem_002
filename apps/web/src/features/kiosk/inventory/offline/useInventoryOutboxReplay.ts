import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { inventoryKeys } from '../../../../api/queryKeys/itemInventory';

import { inventoryOutboxRunner } from './inventoryOutboxRunner';

export function useInventoryOutboxReplay() {
  const queryClient = useQueryClient();
  const runner = inventoryOutboxRunner();
  useEffect(() => {
    const offSent = runner.onSent(() => {
      void queryClient.invalidateQueries({ queryKey: inventoryKeys.itemsAll });
      void queryClient.invalidateQueries({ queryKey: inventoryKeys.tagsAll });
      void queryClient.invalidateQueries({ queryKey: inventoryKeys.historyAll });
    });
    const flush = () => {
      void runner.flush().catch(error => console.warn('Inventory offline replay failed', error));
    };
    flush();
    const timer = window.setInterval(flush, 30_000);
    window.addEventListener('online', flush);
    return () => {
      offSent();
      window.clearInterval(timer);
      window.removeEventListener('online', flush);
    };
  }, [runner, queryClient]);
}
