import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { getResolvedClientKey } from '../../../api/http';
import { createMobileLocalDataStore } from '../local-data/mobileLocalDataStore';

import { importNativeLocalData, pushClientKeyToNative } from './nativeLocalDataImport';
import { canSyncNow } from './networkGate';
import { resetSyncSchedulerForTests, runSyncOperation, subscribeSync } from './syncScheduler';

vi.mock('../../../api/http', () => ({ getResolvedClientKey: vi.fn(() => 'test-client-key') }));
vi.mock('./networkGate', () => ({ canSyncNow: () => false, subscribeCanSync: () => () => {} }));
const snapshot = { version: 'native-v2', dataUpdatedAt: '2026-10-28T00:00:00.000Z', rows: [] };
const fetchMock = vi.fn();
const response = (value: unknown) => ({ ok: true, json: async () => value });
const nativeResponses = (versions: unknown = { purchase: snapshot }, data: unknown = snapshot) => {
  fetchMock.mockResolvedValueOnce(response(versions)).mockResolvedValueOnce(response(data));
};
let store: ReturnType<typeof createMobileLocalDataStore>;
beforeEach(() => {
  store = createMobileLocalDataStore();
  vi.spyOn(store, 'replace');
  window.HaizenNative = { isAvailable: () => true, scanFseiban: vi.fn(), setClientKey: vi.fn() };
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  delete window.HaizenNative;
  resetSyncSchedulerForTests();
  fetchMock.mockReset();
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});

it('imports and notifies subscribers even when the network gate is closed', async () => {
  nativeResponses();
  const listener = vi.fn(); subscribeSync(listener);
  expect(canSyncNow()).toBe(false);
  await importNativeLocalData(store);
  expect(store.replace).toHaveBeenCalledWith({ purchase: snapshot });
  expect(await store.versions()).toEqual({ purchase: { version: snapshot.version, dataUpdatedAt: snapshot.dataUpdatedAt } });
  expect(listener).toHaveBeenCalledOnce();
  expect(fetchMock).toHaveBeenCalledWith('/__haizen-native/local-data/versions', { cache: 'no-store', signal: expect.any(AbortSignal) });
});

it('does not replace the same version', async () => {
  await store.replace({ purchase: snapshot }); vi.mocked(store.replace).mockClear();
  nativeResponses();
  await importNativeLocalData(store);
  expect(store.replace).not.toHaveBeenCalled();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('does not overwrite newer local data', async () => {
  await store.replace({ purchase: { ...snapshot, version: 'web-v3', dataUpdatedAt: '2026-10-29T00:00:00.000Z' } });
  vi.mocked(store.replace).mockClear();
  nativeResponses();
  await importNativeLocalData(store);
  expect(store.replace).not.toHaveBeenCalled();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it.each([null, '2026-10-27T00:00:00.000Z'])('imports a different version when local timestamp is %s', async (dataUpdatedAt) => {
  await store.replace({ purchase: { ...snapshot, version: 'old', dataUpdatedAt } });
  vi.mocked(store.replace).mockClear();
  nativeResponses();
  await importNativeLocalData(store);
  expect(store.replace).toHaveBeenCalledWith({ purchase: snapshot });
});

it('does not replace a different version with the same timestamp', async () => {
  await store.replace({ purchase: { ...snapshot, version: 'web-v3' } });
  vi.mocked(store.replace).mockClear();
  nativeResponses();
  await importNativeLocalData(store);
  expect(store.replace).not.toHaveBeenCalled();
});

it('gives a slow snapshot body more than three seconds', async () => {
  vi.useFakeTimers();
  fetchMock.mockResolvedValueOnce(response({ purchase: snapshot }));
  fetchMock.mockImplementationOnce((_path, { signal }: { signal: AbortSignal }) => Promise.resolve({
    ok: true,
    json: () => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')));
      setTimeout(() => resolve(snapshot), 10_000);
    }),
  }));
  const importing = importNativeLocalData(store);
  await vi.advanceTimersByTimeAsync(10_000);
  await importing;
  expect(store.replace).toHaveBeenCalledWith({ purchase: snapshot });
});

it.each(['missing', 'unavailable', 'throwing'])('does not fetch with a %s bridge', async (state) => {
  if (state === 'missing') delete window.HaizenNative;
  else window.HaizenNative!.isAvailable = () => { if (state === 'throwing') throw new Error('Unavailable'); return false; };
  await expect(importNativeLocalData(store)).resolves.toBeUndefined();
  expect(fetchMock).not.toHaveBeenCalled();
});

it('does not replace or notify when a snapshot version differs from the manifest', async () => {
  nativeResponses(undefined, { ...snapshot, version: 'changed-during-download' });
  const listener = vi.fn(); subscribeSync(listener);
  await importNativeLocalData(store);
  expect(store.replace).not.toHaveBeenCalled();
  expect(listener).not.toHaveBeenCalled();
});

it('imports supported kinds together and ignores unknown kinds', async () => {
  const schedule = { ...snapshot, knownFseibans: [] };
  nativeResponses({ purchase: snapshot, schedule, future: snapshot });
  fetchMock.mockResolvedValueOnce(response(schedule));
  await importNativeLocalData(store);
  expect(store.replace).toHaveBeenCalledExactlyOnceWith({ purchase: snapshot, schedule });
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

it('waits for the web write lane and then reads its latest metadata', async () => {
  let finish!: () => void;
  const writing = runSyncOperation(async () => {
    await new Promise<void>((resolve) => { finish = resolve; });
    await store.replace({ purchase: { ...snapshot, version: 'web-v3', dataUpdatedAt: '2026-10-29T00:00:00.000Z' } });
  });
  nativeResponses();
  const importing = importNativeLocalData(store);
  await Promise.resolve();
  expect(fetchMock).not.toHaveBeenCalled();
  finish(); await writing; vi.mocked(store.replace).mockClear(); await importing;
  expect(store.replace).not.toHaveBeenCalled();
});

it('stops quietly on a missing file or failed fetch', async () => {
  fetchMock.mockResolvedValueOnce({ ok: false });
  await expect(importNativeLocalData(store)).resolves.toBeUndefined();
  fetchMock.mockRejectedValueOnce(new Error('offline'));
  await expect(importNativeLocalData(store)).resolves.toBeUndefined();
  expect(store.replace).not.toHaveBeenCalled();
});

it('aborts a stalled local request after three seconds', async () => {
  vi.useFakeTimers();
  fetchMock.mockImplementationOnce((_path, { signal }: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')));
  }));
  const importing = importNativeLocalData(store);
  await vi.advanceTimersByTimeAsync(3_000);
  await expect(importing).resolves.toBeUndefined();
  expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  expect(store.replace).not.toHaveBeenCalled();
});

it('passes the resolved kiosk key and tolerates missing or failing setClientKey', () => {
  pushClientKeyToNative();
  expect(window.HaizenNative!.setClientKey).toHaveBeenCalledWith('test-client-key');
  expect(getResolvedClientKey).toHaveBeenCalled();
  window.HaizenNative!.setClientKey = () => { throw new Error('Unavailable'); };
  expect(pushClientKeyToNative).not.toThrow();
  delete window.HaizenNative!.setClientKey;
  expect(pushClientKeyToNative).not.toThrow();
  delete window.HaizenNative;
  expect(pushClientKeyToNative).not.toThrow();
});
