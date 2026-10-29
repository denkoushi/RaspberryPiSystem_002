import { MOBILE_REQUEST_TIMEOUT_MS, mobileRequest } from '../connectivity';

import { mobileLocalDataStore } from './mobileLocalDataStore';

import type { MobileLocalDataStore, PagedDataset } from './mobileLocalDataStore';
import type { BasePurchaseTuple, DatasetVersion, PlacementTuple, ScheduleTuple, SnapshotPage, MobileDataVersions, PlacementsSnapshot, MobilePurchaseSnapshot, PurchaseEnrichmentSnapshot, ScheduleSnapshot } from '@raspi-system/slip-match-core';

const base = '/kiosk/mobile-local-data';
const requestOptions = { kioskTelemetry: 'background', timeout: MOBILE_REQUEST_TIMEOUT_MS } as const;
const snapshotTimeoutMs = 180_000;
type MobileSnapshotPage = SnapshotPage<BasePurchaseTuple | ScheduleTuple | PlacementTuple> & { format?: 2 };
export const mobileDataApi = {
  async versions() {
    const { api } = await import('../../../api/http');
    return (await mobileRequest(() => api.get<MobileDataVersions>(`${base}/versions`, { ...requestOptions, params: { format: '2' } }))).data;
  },
  async page(kind: PagedDataset, page: number, pageVersion: string, pageSize?: number) {
    const { api } = await import('../../../api/http');
    const response = await mobileRequest(() => api.get<MobileSnapshotPage>(`${base}/${kind}`, {
      ...requestOptions, timeout: snapshotTimeoutMs, params: { format: '2', page, pageVersion, pageSize },
      validateStatus: (status) => status === 200 || status === 409
    }), { timeoutMs: snapshotTimeoutMs });
    return response.status === 409 ? null : response.data;
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
export function createMobileDataSync(store: MobileLocalDataStore, remote: Omit<typeof mobileDataApi, 'purchaseEnrichment' | 'page'> & Partial<Pick<typeof mobileDataApi, 'purchaseEnrichment' | 'page'>> = mobileDataApi) {
  let pending: Promise<void> | undefined;
  const baseDelay = 30 * 60 * 1000;
  let retryDelay = baseDelay;
  let retryAt = 0;
  let failedVersions: string | undefined;
  async function stagePages(kind: PagedDataset, expected: DatasetVersion) {
    if (!remote.page) throw new Error('Mobile paged API unavailable');
    let state = await store.stagingState(kind);
    if (state && state.version !== expected.version) {
      await store.discardStaging(kind);
      state = undefined;
    }
    while (!state || state.nextPage <= state.pageCount) {
      const page = state?.nextPage ?? 1;
      const snapshot = await remote.page(kind, page, expected.version, state?.pageSize);
      if (!snapshot || snapshot.version !== expected.version || snapshot.page !== page ||
          kind === 'purchase' && snapshot.format !== 2 ||
          state && (snapshot.pageSize !== state.pageSize || snapshot.pageCount !== state.pageCount)) {
        await store.discardStaging(kind);
        throw new Error('Mobile data changed during paged download');
      }
      await store.writeStagingPage(kind, snapshot, page, snapshot.pageCount, snapshot.rows, snapshot.pageSize, snapshot.knownFseibans);
      state = await store.stagingState(kind);
    }
  }
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
        if (latest.paged) {
          if (!independent) throw new Error('Mobile paged purchase format unavailable');
          const changed: PagedDataset[] = [];
          if (purchaseVersion !== latest.purchase.version) {
            await stagePages('purchase', latest.purchase);
            changed.push('purchase');
          }
          const needsEnrichment = local.purchaseEnrichment?.version !== latest.purchaseEnrichment!.version;
          const purchaseEnrichment = needsEnrichment ? await remote.purchaseEnrichment?.(local.purchaseEnrichment?.version) : null;
          if (needsEnrichment && (!purchaseEnrichment || purchaseEnrichment.version !== latest.purchaseEnrichment!.version)) {
            throw new Error('Mobile purchase enrichment unavailable or changed during download');
          }
          if (local.schedule?.version !== latest.schedule.version) {
            await stagePages('schedule', latest.schedule);
            changed.push('schedule');
          }
          if (latest.placements && local.placements?.version !== latest.placements.version) {
            await stagePages('placements', latest.placements);
            changed.push('placements');
          }
          if (purchaseEnrichment) await store.replace({ purchaseEnrichment });
          for (const kind of changed) await store.promoteStaging(kind);
        } else {
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
        }
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
