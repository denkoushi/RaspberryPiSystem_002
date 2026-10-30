import { mobileRequest } from '../connectivity';
import { canSyncNow } from '../sync/networkGate';

import { mobileLocalDataStore } from './mobileLocalDataStore';

import type { MobileLocalDataStore } from './mobileLocalDataStore';
import type { PurchaseOrderLookupResponse } from '../../../api/domains/kiosk';
import type { ActualSlipOcrResponse, MobilePlacementSlipMatchResponse } from '../../../api/domains/mobile-placement';
import type { SlipPairMatchInput } from '@raspi-system/slip-match-core';

/** A long local-data publish holds the IndexedDB stores; answer from the server instead of waiting. */
export const LOCAL_READ_TIMEOUT_MS = 2000;

async function readLocal<T>(read: () => Promise<T | null>, timeoutMs = LOCAL_READ_TIMEOUT_MS): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([read(), new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); })]);
  } finally {
    clearTimeout(timer);
  }
}

export async function lookupPurchaseLocalFirst(order: string, server: () => Promise<PurchaseOrderLookupResponse>,
  store: MobileLocalDataStore = mobileLocalDataStore, online = canSyncNow()): Promise<PurchaseOrderLookupResponse> {
  const local = await readLocal(() => store.lookupPurchase(order));
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
  const local = await readLocal(() => store.verify(input));
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
  const local = await readLocal(() => store.snapNative(tokens, text));
  if (!local) {
    if (!online || !canSyncNow()) throw new Error('Mobile local data unavailable offline');
    return mobileRequest(server);
  }
  if (local.fseibanMatch === 'none' && online && canSyncNow()) {
    try { return await mobileRequest(server); } catch { /* Preserve the device OCR result. */ }
  }
  return local;
}
