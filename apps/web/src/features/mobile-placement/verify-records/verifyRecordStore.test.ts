import { describe, expect, it } from 'vitest';

import { createVerifyRecordStore, type VerifyRecord } from './verifyRecordStore';

const record: VerifyRecord = { clientVerifyId: 'verify', verifiedAt: '2026-10-29T00:00:00Z',
  transferOrderBarcodeRaw: '0002178005', actualOrderBarcodeRaw: '4501238876', actualFseibanRaw: '', outcome: 'match' };
describe('verify record store memory fallback', () => {
  it('stores snapshots, updates links in place and removes an acknowledged record', async () => {
    const store = createVerifyRecordStore();
    await store.put(record);
    const listed = await store.list();
    listed[0].outcome = 'error';
    expect((await store.list())[0].outcome).toBe('match');
    const linked = { ...record, clientRecordId: 'placement' };
    await store.put(linked);
    expect(await store.list()).toEqual([linked]);
    await store.remove(linked);
    expect(await store.list()).toEqual([]);
  });
  it('preserves a link added while an unlinked upload was in flight', async () => {
    const store = createVerifyRecordStore();
    await store.put(record);
    const [upload] = await store.list();
    await store.put({ ...record, clientRecordId: 'placement' });
    await store.remove(upload);
    expect(await store.list()).toEqual([{ ...record, clientRecordId: 'placement' }]);
  });
  it('serializes a write, list and acknowledgement without losing updates', async () => {
    const store = createVerifyRecordStore();
    await Promise.all([store.put(record), store.list(), store.put({ ...record, clientRecordId: 'placement' }), store.remove(record)]);
    expect((await store.list())[0].clientRecordId).toBe('placement');
  });
});
