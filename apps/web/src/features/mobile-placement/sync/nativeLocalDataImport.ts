import { getResolvedClientKey } from '../../../api/http';
import { isHaizenNativeAvailable } from '../haizenNative';
import { mobileLocalDataStore } from '../local-data/mobileLocalDataStore';

import { notifySyncListeners, runSyncOperation } from './syncScheduler';

import type { MobileLocalDataStore } from '../local-data/mobileLocalDataStore';

type Replacement = Parameters<MobileLocalDataStore['replace']>[0];
type Kind = keyof Replacement;
type Versions = Awaited<ReturnType<MobileLocalDataStore['versions']>>;
// Add one entry when the store gains a dataset. The type check keeps this list exhaustive.
const supportedKinds = { purchase: true, purchaseEnrichment: true, schedule: true, placements: true } satisfies Record<Kind, true>;
const base = '/__haizen-native/local-data';

export function pushClientKeyToNative(): void {
  try {
    if (typeof window !== 'undefined' && typeof window.HaizenNative?.setClientKey === 'function') {
      window.HaizenNative.setClientKey(getResolvedClientKey());
    }
  } catch { /* Older shells and unavailable storage must not interrupt the page. */ }
}

// The timeout also covers reading the body, so snapshots get the web downloader's budget.
async function readNativeJson<T>(path: string, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(path, { cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error('Native local data unavailable');
    return await response.json() as T;
  } finally { clearTimeout(timeout); }
}

export async function importNativeLocalData(store: MobileLocalDataStore = mobileLocalDataStore): Promise<void> {
  if (!isHaizenNativeAvailable()) return;
  try {
    // Local file reads must work offline, but share the web downloader's write lane.
    await runSyncOperation(async () => {
      const native = await readNativeJson<Versions>(`${base}/versions`, 3_000);
      const local = await store.versions();
      const replacement: Replacement = {};
      const collect = async <K extends Kind>(kind: K) => {
        const next = native[kind];
        const current = local[kind];
        if (!next || next.version === current?.version) return;
        // Equal timestamps can hide a deletion, so only a strictly newer file replaces local data.
        if (current && (!current.dataUpdatedAt || !next.dataUpdatedAt ||
            !(Date.parse(next.dataUpdatedAt) > Date.parse(current.dataUpdatedAt)))) return;
        const snapshot = await readNativeJson<NonNullable<Replacement[K]>>(`${base}/${kind}`, 180_000);
        if (kind === 'purchase' && (!('format' in snapshot) || snapshot.format !== 2)) return;
        if (snapshot.version !== next.version) throw new Error('Native local data version changed');
        replacement[kind] = snapshot;
      };
      for (const kind of Object.keys(supportedKinds) as Kind[]) await collect(kind);
      if (Object.keys(replacement).length > 0) {
        await store.replace(replacement);
        notifySyncListeners();
      }
    });
  } catch { /* Missing files, old shells and failed imports are retried on the next foreground. */ }
}
