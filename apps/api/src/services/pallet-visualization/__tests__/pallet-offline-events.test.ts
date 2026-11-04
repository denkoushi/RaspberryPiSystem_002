import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ lookup: vi.fn(), transaction: vi.fn(), item: vi.fn(), create: vi.fn(), event: vi.fn(), resolve: vi.fn() }));
vi.mock('../../../lib/prisma.js', () => ({ prisma: {
  machinePalletEvent: { findFirst: mocks.lookup }, machinePalletItem: { findUnique: mocks.item },
  $transaction: mocks.transaction,
} }));
vi.mock('../../../lib/pallet-machine-illustration-storage.js', () => ({ PalletMachineIllustrationStorage: {} }));
vi.mock('../pallet-visualization-resource.service.js', () => ({ assertMachineCdRegistered: async (cd: string) => cd, getPalletCountForResource: async () => 10 }));
vi.mock('../pallet-visualization-schedule-resolver.js', () => ({ resolveScheduleSnapshotForPalletItem: mocks.resolve }));
vi.mock('../pallet-command-lock.js', () => ({ acquirePalletCommandLock: vi.fn(), mapPalletOrderConflict: (error: unknown) => { throw error; } }));
import { commandAddPalletItem, commandReplacePalletItem } from '../pallet-visualization-command.service.js';
import { palletEventFingerprint } from '../pallet-event.js';

const input = { clientDeviceId: 'device', eventKey: 'e23cb1cb-2910-4b0a-9e30-d906217569fa', machineCd: 'MC', palletNo: 1, manufacturingOrderBarcodeRaw: 'ORDER' };
const replace = { clientDeviceId: input.clientDeviceId, eventKey: input.eventKey, itemId: 'item', manufacturingOrderBarcodeRaw: 'ORDER' };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.lookup.mockResolvedValue(null);
  mocks.item.mockResolvedValue({ id: 'item', resourceCd: 'MC', palletNo: 1 });
  mocks.resolve.mockResolvedValue({ scheduleSnapshot: {} });
  mocks.create.mockResolvedValue({ id: 'item' });
  mocks.transaction.mockImplementation(async callback => callback({
    machinePalletItem: { aggregate: async () => ({ _max: { displayOrder: 0 } }), create: mocks.create, update: mocks.create, findUnique: mocks.item },
    machinePalletEvent: { create: mocks.event },
  }));
});
describe('pallet offline events', () => {
  it.each(['add', 'replace'])('replays %s before validation, including after item deletion', async operation => {
    const body = operation === 'add' ? input : replace;
    const command = operation === 'add' ? commandAddPalletItem : commandReplacePalletItem;
    const result = await command(body as typeof input & typeof replace);
    mocks.lookup.mockResolvedValue({ affectedItemId: result.id, eventFingerprint: palletEventFingerprint(body, operation === 'add' ? 'SET_ITEM' : 'REPLACE_ITEM') });
    mocks.item.mockResolvedValue(null);
    mocks.resolve.mockRejectedValue(new Error('schedule removed'));
    expect(await command(body as typeof input & typeof replace)).toEqual(result);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });
  it.each([{ ...input, manufacturingOrderBarcodeRaw: 'OTHER' }, { ...input, palletNo: 2 }])('rejects changed add body', async changed => {
    mocks.lookup.mockResolvedValue({ affectedItemId: 'item', eventFingerprint: palletEventFingerprint(input, 'SET_ITEM') });
    await expect(commandAddPalletItem(changed)).rejects.toMatchObject({ statusCode: 409, code: 'EVENT_KEY_REUSED' });
  });
  it('rejects changed replace itemId or operation', async () => {
    mocks.lookup.mockResolvedValue({ affectedItemId: 'item', eventFingerprint: palletEventFingerprint(replace, 'REPLACE_ITEM') });
    await expect(commandReplacePalletItem({ ...replace, itemId: 'other' })).rejects.toMatchObject({ statusCode: 409 });
    await expect(commandAddPalletItem(input)).rejects.toMatchObject({ statusCode: 409 });
  });
  it('recovers the winner of a concurrent unique constraint conflict', async () => {
    let committed = false;
    mocks.lookup.mockImplementation(async () => committed ? { affectedItemId: 'item', eventFingerprint: palletEventFingerprint(input, 'SET_ITEM') } : null);
    mocks.transaction.mockImplementation(async () => {
      if (committed) throw new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: '7' });
      committed = true;
      return { id: 'item' };
    });
    expect(await Promise.all([commandAddPalletItem(input), commandAddPalletItem(input)])).toEqual([{ id: 'item' }, { id: 'item' }]);
  });
  it('accepts legacy bodies without event lookup', async () => {
    const { eventKey: _key, ...legacy } = input;
    expect(await commandAddPalletItem(legacy)).toEqual({ id: 'item' });
    expect(mocks.lookup).not.toHaveBeenCalled();
    expect(mocks.event.mock.calls[0][0].data.eventKey).toBeUndefined();
  });
  it('saves readAt and event metadata in the business transaction', async () => {
    const readAt = new Date(Date.now() - 60_000);
    await commandAddPalletItem({ ...input, readAt });
    expect(mocks.event.mock.calls[0][0].data).toMatchObject({ eventKey: input.eventKey, readAt, affectedItemId: 'item' });
  });
  it.each([5 * 60_000 + 1000, -7 * 24 * 60 * 60_000 - 1000])('accepts out-of-range readAt %s with server time', async delta => {
    const before = Date.now();
    await expect(commandAddPalletItem({ ...input, readAt: new Date(Date.now() + delta) })).resolves.toEqual({ id: 'item' });
    const stored: Date = mocks.event.mock.calls[0][0].data.readAt;
    expect(stored.getTime()).toBeGreaterThanOrEqual(before);
    expect(stored.getTime()).toBeLessThanOrEqual(Date.now());
  });
  it('fingerprints readAt and replacement barcode changes', async () => {
    const body = { ...replace, readAt: new Date() };
    mocks.lookup.mockResolvedValue({ affectedItemId: 'item', eventFingerprint: palletEventFingerprint(body, 'REPLACE_ITEM') });
    await expect(commandReplacePalletItem({ ...body, readAt: new Date(body.readAt.getTime() - 1) })).rejects.toMatchObject({ statusCode: 409 });
    await expect(commandReplacePalletItem({ ...body, manufacturingOrderBarcodeRaw: 'OTHER' })).rejects.toMatchObject({ statusCode: 409 });
  });
  it('acknowledges an accepted event even after readAt ages beyond the range', async () => {
    const body = { ...input, readAt: new Date(Date.now() - 8 * 24 * 60 * 60_000) };
    mocks.lookup.mockResolvedValue({ affectedItemId: 'deleted', eventFingerprint: palletEventFingerprint(body, 'SET_ITEM') });
    expect(await commandAddPalletItem(body)).toEqual({ id: 'deleted' });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

});
