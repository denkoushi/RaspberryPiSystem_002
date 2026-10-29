import { MOBILE_REQUEST_TIMEOUT_MS, mobileRequest } from '../connectivity';

import { mobileLocalDataStore } from './mobileLocalDataStore';

import type { MobileLocalDataStore } from './mobileLocalDataStore';
import type { MobileDataVersions, PlacementsSnapshot, MobilePurchaseSnapshot, PurchaseEnrichmentSnapshot, ScheduleSnapshot } from '@raspi-system/slip-match-core';

const base = '/kiosk/mobile-local-data';
const requestOptions = { kioskTelemetry: 'background', timeout: MOBILE_REQUEST_TIMEOUT_MS } as const;
const snapshotTimeoutMs = 180_000;
export const mobileDataApi = {
  async versions() {
    const { api } = await import('../../../api/http');
    return (await mobileRequest(() => api.get<MobileDataVersions>(`${base}/versions`, { ...requestOptions, params: { format: '2' } }))).data;
  },
  async purchase(version?: string, independent = false) {
    const { api } = await import('../../../api/http');
    const response = await mobileRequest(() => api.get<MobilePurchaseSnapshot>(`${base}/purchase`, {
      ...requestOptions, timeout: snapshotTimeoutMs, params: { version, ...(independent ? { format: '2' } : {}) }, validateStatus: (status) => status === 200 || status === 304
    }), { timeoutMs: snapshotTimeoutMs });
    return response.status === 304 ? null : response.data;
  },
  async purchaseEnrichment(version?: string) {
    const { api } = await import('../../../api/http');
    const response = await mobileRequest(() => api.get<PurchaseEnrichmentSnapshot>(`${base}/purchaseEnrichment`, {
      ...requestOptions, timeout: snapshotTimeoutMs, params: { version }, validateStatus: (status) => status === 200 || status === 304
    }), { timeoutMs: snapshotTimeoutMs });
    return response.status === 304 ? null : response.data;
  },
  async placements(version?: string) {
    const { api } = await import('../../../api/http');
    const response = await mobileRequest(() => api.get<PlacementsSnapshot>(`${base}/placements`, {
      ...requestOptions, timeout: snapshotTimeoutMs, params: { version }, validateStatus: (status) => status === 200 || status === 304
    }), { timeoutMs: snapshotTimeoutMs });
    return response.status === 304 ? null : response.data;
  },
  async schedule(version?: string) {
    const { api } = await import('../../../api/http');
    const response = await mobileRequest(() => api.get<ScheduleSnapshot>(`${base}/schedule`, {
      ...requestOptions, timeout: snapshotTimeoutMs, params: { version }, validateStatus: (status) => status === 200 || status === 304
    }), { timeoutMs: snapshotTimeoutMs });
    return response.status === 304 ? null : response.data;
  }
};
export function createMobileDataSync(store: MobileLocalDataStore, remote: Omit<typeof mobileDataApi, 'purchaseEnrichment'> & Partial<Pick<typeof mobileDataApi, 'purchaseEnrichment'>> = mobileDataApi) {
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
        versionKey = JSON.stringify([latest.purchase.version, latest.schedule.version, latest.placements?.version, latest.purchaseEnrichment?.version]);
        if (Date.now() < retryAt && (failedVersions === undefined || failedVersions === versionKey)) return;
        const local = await store.versions();
        const independent = !!latest.purchaseEnrichment;
        const purchaseVersion = (local.purchase?.format === 2) === independent ? local.purchase?.version : undefined;
        const purchase = purchaseVersion !== latest.purchase.version
          ? independent ? await remote.purchase(purchaseVersion, true) : await remote.purchase(purchaseVersion) : null;
        const needsEnrichment = latest.purchaseEnrichment && local.purchaseEnrichment?.version !== latest.purchaseEnrichment.version;
        const purchaseEnrichment = needsEnrichment ? await remote.purchaseEnrichment?.(local.purchaseEnrichment?.version) : null;
        if (needsEnrichment && !purchaseEnrichment ||
            purchase && ('format' in purchase && purchase.format === 2) !== independent) {
          throw new Error('Mobile purchase format or enrichment unavailable');
        }
        const schedule = local.schedule?.version !== latest.schedule.version ? await remote.schedule(local.schedule?.version) : null;
        // An API that predates placements omits its version; keep purchase/schedule syncing.
        const placements = latest.placements && local.placements?.version !== latest.placements.version
          ? await remote.placements(local.placements?.version) : null;
        if (purchaseEnrichment && purchaseEnrichment.version !== latest.purchaseEnrichment?.version || placements && placements.version !== latest.placements?.version || purchase && purchase.version !== latest.purchase.version || schedule && schedule.version !== latest.schedule.version) {
          throw new Error('Mobile data changed during download');
        }
        if (purchase || schedule || placements || purchaseEnrichment) await store.replace({ ...(purchaseEnrichment ? { purchaseEnrichment } : {}), ...(placements ? { placements } : {}), ...(purchase ? { purchase } : {}), ...(schedule ? { schedule } : {}) });
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
