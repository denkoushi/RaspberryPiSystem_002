import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../../../api/client';
import { canSyncNow } from '../sync/networkGate';

import { createScanFrameUploadRunner } from './scanFrameUploadRunner';

import type { ScanFrameRecord, ScanFrameStore } from './scanFrameStore';
import type { HaizenQueueRecord } from '../haizen/offline/haizenOfflineQueueStore';

vi.mock('../../../api/client', () => ({ api: { post: vi.fn() }, getResolvedClientKey: () => 'test-key' }));
vi.mock('../sync/networkGate', () => ({ canSyncNow: vi.fn() }));
const makeRecord = (id = 'frame', kind: ScanFrameRecord['kind'] = 'scan-frame', size = 3): ScanFrameRecord => ({
  id, kind, clientRecordId: kind === 'placement-photo' ? 'placement' : undefined,
  meta: { outcome: 'decoded', decodedValue: '001', decodeMs: 100, retryCount: 0, engine: 'native', camera: {}, cropBox: null, capturedAt: '2026-10-29T00:00:00Z' },
  fullJpeg: new Blob([new Uint8Array(size)], { type: 'image/jpeg' }), createdAt: '2026-10-29T00:00:00Z'
});
function setup(records = [makeRecord()]) {
  let rows = [...records];
  const store: ScanFrameStore = {
    list: vi.fn(async () => rows), put: vi.fn(), updateManualValue: vi.fn(),
    remove: vi.fn(async (id) => { rows = rows.filter((record) => record.id !== id); })
  };
  const haizen = { list: vi.fn(async (): Promise<HaizenQueueRecord[]> => []) };
  return { store, haizen, runner: createScanFrameUploadRunner(store, haizen) };
}
beforeEach(() => { vi.clearAllMocks(); vi.mocked(canSyncNow).mockReturnValue(true); vi.mocked(api.post).mockResolvedValue({ status: 201 }); });
describe('scan frame upload runner', () => {
  it.each([200, 201, 204, 409, 400, 413, 422])('removes after status %s', async (status) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { store, runner } = setup();
    if (status >= 400) vi.mocked(api.post).mockRejectedValue({ isAxiosError: true, response: { status } });
    else vi.mocked(api.post).mockResolvedValue({ status });
    await runner.run();
    expect(await store.list()).toEqual([]);
    expect(warn).toHaveBeenCalledTimes([400, 413, 422].includes(status) ? 1 : 0);
    expect(api.post).toHaveBeenCalledWith('/mobile-placement/scan-frames', expect.objectContaining({ clientFrameId: 'frame', kind: 'scan_frame' }), expect.objectContaining({ headers: { 'x-client-key': 'test-key' }, timeout: 30_000 }));
    warn.mockRestore();
  });
  it.each([undefined, 507, 500, 503, 401, 403, 408, 429])('keeps record and stops on status %s', async (status) => {
    const { store, runner } = setup([makeRecord('1'), makeRecord('2')]);
    vi.mocked(api.post).mockRejectedValue({ isAxiosError: true, response: status ? { status } : undefined });
    await runner.run();
    expect(await store.list()).toHaveLength(2);
    expect(api.post).toHaveBeenCalledTimes(1);
  });
  it.each(['pending', 'needs_check'] as const)('waits for haizen %s records and only reads its queue', async (status) => {
    const { store, haizen, runner } = setup([makeRecord('photo', 'placement-photo'), makeRecord('scan')]);
    haizen.list.mockResolvedValue([{ clientRecordId: 'placement', status } as HaizenQueueRecord]);
    await runner.run();
    expect((await store.list()).map((record) => record.id)).toEqual(['photo']);
    expect(await runner.hasPendingWork()).toBe(false);
    haizen.list.mockResolvedValue([]);
    expect(await runner.hasPendingWork()).toBe(true);
    await runner.run();
    expect(await store.list()).toEqual([]);
    expect(api.post).toHaveBeenCalledTimes(2);
  });
  it('limits each run to 20 records and shares concurrent runs', async () => {
    const { store, runner } = setup(Array.from({ length: 21 }, (_, index) => makeRecord(String(index))));
    await Promise.all([runner.run(), runner.run()]);
    expect(api.post).toHaveBeenCalledTimes(20);
    expect(await store.list()).toHaveLength(1);
  });
  it('limits actual JSON upload bytes including base64 expansion to 2MB', async () => {
    const { store, runner } = setup(Array.from({ length: 4 }, (_, index) => makeRecord(String(index), 'scan-frame', 600 * 1024)));
    await runner.run();
    expect(api.post).toHaveBeenCalledTimes(2);
    expect(await store.list()).toHaveLength(2);
  });
  it('leaves a timeout for the next scheduler pass so immediate manual input is included', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-29T00:00:00Z'));
    const frame = makeRecord();
    frame.meta.outcome = 'timeout'; frame.meta.decodedValue = null;
    const { store, runner } = setup([frame]);
    await runner.run();
    expect(api.post).not.toHaveBeenCalled();
    expect(await runner.hasPendingWork()).toBe(false);
    frame.manualValue = '001';
    now.mockReturnValue(Date.parse('2026-10-29T00:00:30Z'));
    expect(await runner.hasPendingWork()).toBe(true);
    await runner.run();
    expect(api.post).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ manualValue: '001' }), expect.any(Object));
    expect(await store.list()).toEqual([]);
    now.mockRestore();
  });
  it('sends an oversized first record and advances to later records on the next pass', async () => {
    const { store, runner } = setup([makeRecord('large', 'scan-frame', 2 * 1024 * 1024), makeRecord('next')]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(api.post).mockRejectedValueOnce({ isAxiosError: true, response: { status: 413 } });
    await runner.run();
    expect(api.post).toHaveBeenCalledTimes(1);
    expect((await store.list()).map((record) => record.id)).toEqual(['next']);
    await runner.run();
    expect(await runner.hasPendingWork()).toBe(false);
    expect(api.post).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
  it('discards a broken payload with a warning and sends the following record', async () => {
    const broken = makeRecord('broken');
    broken.fullJpeg = {} as Blob;
    const { store, runner } = setup([broken, makeRecord('next')]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await runner.run();
    expect(warn).toHaveBeenCalledWith('Scan frame payload could not be created', 'broken');
    expect(api.post).toHaveBeenCalledExactlyOnceWith(expect.any(String), expect.objectContaining({ clientFrameId: 'next' }), expect.any(Object));
    expect(await store.list()).toEqual([]);
    warn.mockRestore();
  });
  it('rechecks Wi-Fi before sending each record', async () => {
    const { store, runner } = setup([makeRecord('1'), makeRecord('2')]);
    vi.mocked(canSyncNow).mockReturnValue(false);
    await runner.run(); expect(api.post).not.toHaveBeenCalled();
    vi.mocked(canSyncNow).mockReturnValue(true);
    vi.mocked(api.post).mockImplementation(async () => { vi.mocked(canSyncNow).mockReturnValue(false); return { status: 201 }; });
    await runner.run();
    expect(await store.list()).toHaveLength(1);
  });
});
