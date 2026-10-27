import { canUseMobileNetwork, mobileRequest } from '../connectivity';

import { mobileLocalDataStore } from './mobileLocalDataStore';

import type { MobileLocalDataStore } from './mobileLocalDataStore';
import type { PurchaseOrderLookupResponse } from '../../../api/domains/kiosk';
import type { MobilePlacementSlipMatchResponse } from '../../../api/domains/mobile-placement';
import type { SlipPairMatchInput } from '@raspi-system/slip-match-core';

export async function lookupPurchaseLocalFirst(order: string, server: () => Promise<PurchaseOrderLookupResponse>,
  store: MobileLocalDataStore = mobileLocalDataStore, online = canUseMobileNetwork()): Promise<PurchaseOrderLookupResponse> {
  const local = await store.lookupPurchase(order);
  if (!local) {
    if (!online) throw new Error('Mobile local data unavailable offline');
    return mobileRequest(server);
  }
  if (local.rows.length || !online) return local;
  // A missed row can be newer than this device's snapshot. A failed supplement must not hide the local result.
  try { return await mobileRequest(server); } catch { return local; }
}
export async function verifyLocalFirst(input: SlipPairMatchInput, server: () => Promise<MobilePlacementSlipMatchResponse>,
  store: MobileLocalDataStore = mobileLocalDataStore, online = canUseMobileNetwork()) {
  const local = await store.verify(input);
  if (!local) {
    if (!online) throw new Error('Mobile local data unavailable offline');
    return mobileRequest(server);
  }
  if (!online || (local.reason !== 'order_not_found' && local.reason !== 'transfer_not_found')) return local;
  try { return await mobileRequest(server); } catch { return local; }
}
