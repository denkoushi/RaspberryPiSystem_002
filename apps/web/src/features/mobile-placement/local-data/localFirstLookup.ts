import { mobileRequest } from '../connectivity';
import { canSyncNow } from '../sync/networkGate';

import { mobileLocalDataStore } from './mobileLocalDataStore';

import type { MobileLocalDataStore } from './mobileLocalDataStore';
import type { PurchaseOrderLookupResponse } from '../../../api/domains/kiosk';
import type { ActualSlipOcrResponse, MobilePlacementSlipMatchResponse } from '../../../api/domains/mobile-placement';
import type { SlipPairMatchInput } from '@raspi-system/slip-match-core';

export async function lookupPurchaseLocalFirst(order: string, server: () => Promise<PurchaseOrderLookupResponse>,
  store: MobileLocalDataStore = mobileLocalDataStore, online = canSyncNow()): Promise<PurchaseOrderLookupResponse> {
  const local = await store.lookupPurchase(order);
  if (!local) {
    if (!online || !canSyncNow()) throw new Error('Mobile local data unavailable offline');
    return mobileRequest(server);
  }
  if (local.rows.length === 0 && online && canSyncNow()) {
    try { return await mobileRequest(server); } catch { /* Keep the offline answer on network failure. */ }
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
  if ((local.reason === 'transfer_not_found' || local.reason === 'order_not_found') && online && canSyncNow()) {
    try { return await mobileRequest(server); } catch { /* Keep the offline answer on network failure. */ }
  }
  return local;
}

export async function snapNativeLocalFirst(tokens: string[], text: string, server: () => Promise<ActualSlipOcrResponse>,
  store: MobileLocalDataStore = mobileLocalDataStore, online = canSyncNow()) {
  const local = await store.snapNative(tokens, text);
  if (!local) {
    if (!online || !canSyncNow()) throw new Error('Mobile local data unavailable offline');
    return mobileRequest(server);
  }
  if (local.fseibanMatch === 'none' && online && canSyncNow()) {
    try { return await mobileRequest(server); } catch { /* Preserve the device OCR result. */ }
  }
  return local;
}
