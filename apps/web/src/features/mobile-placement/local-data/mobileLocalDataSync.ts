import { mobileLocalDataStore } from './mobileLocalDataStore';

import type { MobileLocalDataStore } from './mobileLocalDataStore';
import type { MobileDataVersions, PurchaseSnapshot, ScheduleSnapshot } from '@raspi-system/slip-match-core';

const base = '/kiosk/mobile-local-data';
const requestOptions = { kioskTelemetry: 'background', timeout: 180_000 } as const;
export const mobileDataApi = {
  async versions() {
    const { api } = await import('../../../api/http');
    return (await api.get<MobileDataVersions>(`${base}/versions`, requestOptions)).data;
  },
  async purchase(version?: string) {
    const { api } = await import('../../../api/http');
    const response = await api.get<PurchaseSnapshot>(`${base}/purchase`, {
      ...requestOptions, params: { version }, validateStatus: (status) => status === 200 || status === 304
    });
    return response.status === 304 ? null : response.data;
  },
  async schedule(version?: string) {
    const { api } = await import('../../../api/http');
    const response = await api.get<ScheduleSnapshot>(`${base}/schedule`, {
      ...requestOptions, params: { version }, validateStatus: (status) => status === 200 || status === 304
    });
    return response.status === 304 ? null : response.data;
  }
};
export function createMobileDataSync(store: MobileLocalDataStore, remote = mobileDataApi) {
  let pending: Promise<void> | undefined;
  const baseDelay = 30 * 60 * 1000;
  let retryDelay = baseDelay;
  let retryAt = 0;
  let failedVersions: string | undefined;
  return () => {
    if (pending) return pending;
    const sync = async () => {
      let versionKey: string | undefined;
      try {
        // Even during backoff a lightweight check can discover a repaired/new dataset.
        const latest = await remote.versions();
        versionKey = JSON.stringify([latest.purchase.version, latest.schedule.version]);
        if (Date.now() < retryAt && (failedVersions === undefined || failedVersions === versionKey)) return;
        const local = await store.versions();
        const purchase = local.purchase?.version !== latest.purchase.version ? await remote.purchase(local.purchase?.version) : null;
        const schedule = local.schedule?.version !== latest.schedule.version ? await remote.schedule(local.schedule?.version) : null;
        if (purchase && purchase.version !== latest.purchase.version || schedule && schedule.version !== latest.schedule.version) {
          throw new Error('Mobile data changed during download');
        }
        if (purchase || schedule) await store.replace({ ...(purchase ? { purchase } : {}), ...(schedule ? { schedule } : {}) });
        retryDelay = baseDelay;
        retryAt = 0;
        failedVersions = undefined;
      } catch (error) {
        // Reconnect/version-check failures inside the wait must not extend it.
        if (Date.now() >= retryAt || (versionKey !== undefined && versionKey !== failedVersions)) {
          failedVersions = versionKey ?? failedVersions;
          retryAt = Date.now() + retryDelay;
          retryDelay = Math.min(retryDelay * 2, 6 * 60 * 60 * 1000);
        }
        throw error;
      }
    };
    pending = sync().finally(() => { pending = undefined; });
    return pending;
  };
}
export const syncMobileLocalData = createMobileDataSync(mobileLocalDataStore);
