import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../../../api/client';
import { canSyncNow } from '../sync/networkGate';

import { createVerifyRecordStore, type VerifyRecord } from './verifyRecordStore';
import { createVerifyRecordUploadRunner } from './verifyRecordUploadRunner';

vi.mock('../../../api/client', () => ({ api: { post: vi.fn() }, getResolvedClientKey: () => 'test-key' }));
vi.mock('../sync/networkGate', () => ({ canSyncNow: vi.fn(() => true) }));
const record: VerifyRecord = { clientVerifyId: 'verify', verifiedAt: '2026-10-29T00:00:00Z',
  transferOrderBarcodeRaw: '0002178005', actualOrderBarcodeRaw: '4501238876', actualFseibanRaw: '', outcome: 'match' };
async function setup() {
  const store = createVerifyRecordStore();
  await store.put(record);
  return { store, runner: createVerifyRecordUploadRunner(store) };
}
beforeEach(() => { vi.resetAllMocks(); vi.mocked(canSyncNow).mockReturnValue(true); });
describe('verify record upload runner', () => {
  it.each([201, 200, 409])('removes acknowledged records on %s', async (status) => {
    const { store, runner } = await setup();
    if (status === 409) vi.mocked(api.post).mockRejectedValue({ isAxiosError: true, response: { status } });
    else vi.mocked(api.post).mockResolvedValue({ status });
    expect(await runner.hasPendingWork()).toBe(true);
    await runner.run();
    expect(await store.list()).toEqual([]);
    expect(await runner.hasPendingWork()).toBe(false);
    expect(api.post).toHaveBeenCalledWith('/mobile-placement/verify-records', record, { headers: { 'x-client-key': 'test-key' }, timeout: 30_000 });
  });
  it.each([undefined, 401, 429, 500])('keeps records after retryable failure %s', async (status) => {
    const { store, runner } = await setup();
    vi.mocked(api.post).mockRejectedValue({ isAxiosError: true, response: { status } });
    await runner.run();
    expect(await store.list()).toEqual([record]);
  });
  it('uploads a link added during an earlier upload on the next run', async () => {
    const { store, runner } = await setup();
    vi.mocked(api.post).mockImplementationOnce(async () => {
      await store.put({ ...record, clientRecordId: 'placement' });
      return { status: 201 };
    });
    await runner.run();
    expect((await store.list())[0].clientRecordId).toBe('placement');
    await runner.run();
    expect(api.post).toHaveBeenLastCalledWith(expect.any(String), { ...record, clientRecordId: 'placement' }, expect.any(Object));
    expect(await store.list()).toEqual([]);
  });
  it('gates uploads and shares concurrent runs', async () => {
    const { store, runner } = await setup();
    vi.mocked(canSyncNow).mockReturnValue(false);
    await runner.run();
    expect(api.post).not.toHaveBeenCalled();
    vi.mocked(canSyncNow).mockReturnValue(true);
    await Promise.all([runner.run(), runner.run()]);
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(await store.list()).toEqual([]);
  });
});
