import { isAxiosError } from 'axios';

import { deleteOrderPlacementBranch } from '../../../../api/domains/mobile-placement';
import { mobileRequest } from '../../connectivity';
import { mobileLocalDataStore } from '../../local-data/mobileLocalDataStore';
import { canSyncNow } from '../../sync/networkGate';
import { requestSync } from '../../sync/syncScheduler';

import { placementDeleteQueueStore } from './placementDeleteQueueStore';

import type { PlacementDeleteQueueStore } from './placementDeleteQueueStore';
import type { MobileLocalDataStore } from '../../local-data/mobileLocalDataStore';
import type { LocalPlacementRow } from '@raspi-system/slip-match-core';

export function createPlacementDeleteOutboxRunner(
  queue: PlacementDeleteQueueStore = placementDeleteQueueStore,
  local: MobileLocalDataStore = mobileLocalDataStore
) {
  let serial = Promise.resolve();
  const enqueue = <T,>(operation: () => Promise<T>) => {
    const work = serial.then(operation);
    serial = work.then(() => undefined, () => undefined);
    return work;
  };
  return {
    submit: (row: LocalPlacementRow) => enqueue(async () => {
      // Persist the original row first: pending hides snapshots too, and a rejected delete can restore it.
      await queue.put({ id: row.id, row, queuedAt: new Date().toISOString(), status: 'pending' });
      await local.removePlacement(row.id);
      requestSync('placement-delete');
    }),
    hasPendingWork: async () => (await queue.list()).some((record) => record.status === 'pending'),
    flush: () => enqueue(async () => {
      for (const record of await queue.list()) {
        if (record.status !== 'pending') continue;
        if (!canSyncNow()) break;
        try {
          await mobileRequest(() => deleteOrderPlacementBranch(record.id));
        } catch (error) {
          const status = isAxiosError(error) ? error.response?.status : undefined;
          if (status !== 404) {
            if (status && status >= 400 && status < 500 && status !== 408 && status !== 429) {
              await local.restorePlacement(record.row);
              await queue.put({ ...record, status: 'needs_check' });
              continue;
            }
            break;
          }
        }
        // A refresh may have reinserted the pending row; remove it before releasing the tombstone.
        await local.removePlacement(record.id);
        await queue.remove(record.id);
        requestSync('placements-refresh');
      }
    })
  };
}

export const placementDeleteOutboxRunner = createPlacementDeleteOutboxRunner();
