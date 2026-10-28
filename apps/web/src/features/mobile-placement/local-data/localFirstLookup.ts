import { mobileRequest } from '../connectivity';
import { canSyncNow } from '../sync/networkGate';

import { mobileLocalDataStore } from './mobileLocalDataStore';

import type { MobileLocalDataStore } from './mobileLocalDataStore';
import type { PurchaseOrderLookupResponse } from '../../../api/domains/kiosk';
import type { MobilePlacementSlipMatchResponse } from '../../../api/domains/mobile-placement';
import type { SlipPairMatchInput } from '@raspi-system/slip-match-core';

export async function lookupPurchaseLocalFirst(order: string, server: () => Promise<PurchaseOrderLookupResponse>,
  store: MobileLocalDataStore = mobileLocalDataStore, online = canSyncNow()): Promise<PurchaseOrderLookupResponse> {
  const local = await store.lookupPurchase(order);
  if (!local) {
    if (!online || !canSyncNow()) throw new Error('Mobile local data unavailable offline');
    return mobileRequest(server);
  }
  return local;
}
export async function verifyLocalFirst(input: SlipPairMatchInput, server: () => Promise<MobilePlacementSlipMatchResponse>,
  store: MobileLocalDataStore = mobileLocalDataStore, online = canSyncNow()) {
  const local = await store.verify(input);
  if (!local) {
    if (!online || !canSyncNow()) throw new Error('Mobile local data unavailable offline');
    return mobileRequest(server);
  }
  return local;
}
