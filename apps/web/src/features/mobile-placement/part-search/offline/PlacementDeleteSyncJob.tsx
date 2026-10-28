import { useEffect } from 'react';

import { registerSyncJob } from '../../sync/syncScheduler';

import { placementDeleteOutboxRunner } from './placementDeleteOutboxRunner';

// Mounted alongside the existing mobile provider so deletes keep syncing after leaving the parts page.
export function PlacementDeleteSyncJob() {
  useEffect(() => registerSyncJob({ name: 'placement-delete-outbox', run: placementDeleteOutboxRunner.flush,
    hasPendingWork: placementDeleteOutboxRunner.hasPendingWork }), []);
  return null;
}
