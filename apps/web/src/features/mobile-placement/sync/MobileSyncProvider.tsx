import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { haizenOutboxRunner } from '../haizen/offline/haizenOutboxRunner';
import { syncMobileLocalData } from '../local-data/mobileLocalDataSync';
import { mobilePlacementQueryKeys } from '../mobilePlacementQueryKeys';
import { scanFrameUploadRunner } from '../scan-frames/scanFrameUploadRunner';
import { shelfOutboxRunner } from '../shelfMaster/offline/shelfOutboxRunner';
import { verifyRecordUploadRunner } from '../verify-records/verifyRecordUploadRunner';

import { importNativeLocalData, pushClientKeyToNative } from './nativeLocalDataImport';
import { registerSyncJob, start, stop } from './syncScheduler';

import type { ReactNode } from 'react';

let persistRequested = false;
export function MobileSyncProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  useEffect(() => {
    const importNative = () => {
      pushClientKeyToNative();
      void importNativeLocalData();
    };
    const onVisibility = () => { if (document.visibilityState === 'visible') importNative(); };
    importNative();
    document.addEventListener('visibilitychange', onVisibility);
    if (!persistRequested) {
      persistRequested = true;
      try { void navigator.storage?.persist?.().catch(() => {}); } catch { /* Best effort. */ }
    }
    const haizen = haizenOutboxRunner();
    const shelf = shelfOutboxRunner();
    const invalidateShelves = () => { void client.invalidateQueries({ queryKey: mobilePlacementQueryKeys.registeredShelves }); };
    const cleanup = [
      haizen.onSent(() => {
        invalidateShelves();
        void client.invalidateQueries({ queryKey: mobilePlacementQueryKeys.orderPlacementBranchesAll });
      }),
      shelf.onSent(invalidateShelves),
      registerSyncJob({ name: 'haizen-outbox', run: haizen.flush, hasPendingWork: haizen.hasPendingWork }),
      registerSyncJob({ name: 'shelf-outbox', run: shelf.flush, hasPendingWork: shelf.hasPendingWork }),
      registerSyncJob({ name: 'local-data', run: syncMobileLocalData }),
      registerSyncJob({ name: 'scan-frames', ...scanFrameUploadRunner }),
      registerSyncJob({ name: 'verify-records', ...verifyRecordUploadRunner })
    ];
    start();
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      stop(); cleanup.forEach((dispose) => dispose());
    };
  }, [client]);
  return <>{children}</>;
}
