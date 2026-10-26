import type { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { listMachinesForShelfRegistration } from '../machine-master-query.service.js';
import { prisma } from '../../../lib/prisma.js';
import { getShelfPhoto, putShelfPhoto, updateShelfMemo } from '../mobile-placement-shelf-photo.service.js';
import { listRegisteredShelvesFromShelfMaster, registerMobilePlacementShelf } from '../mobile-placement-shelf-master.service.js';

vi.mock('../../../lib/prisma.js', () => ({ prisma: {
  mobilePlacementShelf: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), create: vi.fn() },
  mobilePlacementShelfPhoto: { upsert: vi.fn(), findUnique: vi.fn() },
  mobilePlacementShelfLandmark: { findMany: vi.fn() },
  $transaction: vi.fn()
} }));
vi.mock('../machine-master-query.service.js', () => ({ listMachinesForShelfRegistration: vi.fn() }));
const stamp = new Date('2026-10-22T10:00:00Z');
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listMachinesForShelfRegistration).mockResolvedValue({ machines: ['DAD-3220'] });
  vi.mocked(prisma.mobilePlacementShelfLandmark.findMany).mockResolvedValue([]);
  vi.mocked(prisma.$transaction).mockImplementation(async (callback) => callback(prisma as unknown as Prisma.TransactionClient));
  vi.mocked(prisma.mobilePlacementShelf.findUnique).mockResolvedValue({ id: 'shelf' } as never);
  vi.mocked(prisma.mobilePlacementShelfPhoto.upsert).mockResolvedValue({ updatedAt: stamp } as never);
});

describe('shelf photo service', () => {
  it.each([
    ['image/jpeg', jpeg],
    ['image/png', Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])],
    ['image/webp', Buffer.from('RIFF0000WEBP')]
  ])('upserts %s with size and device attribution', async (contentType, bytes) => {
    expect(await putShelfPhoto('西-北-01', { contentType, dataBase64: bytes.toString('base64') }, 'device')).toEqual({ photoUpdatedAt: stamp.toISOString() });
    expect(prisma.mobilePlacementShelfPhoto.upsert).toHaveBeenCalledWith({
      where: { shelfId: 'shelf' },
      create: { shelfId: 'shelf', bytes, contentType, byteSize: bytes.length, updatedByClientDeviceId: 'device' },
      update: { bytes, contentType, byteSize: bytes.length, updatedByClientDeviceId: 'device' }, select: { updatedAt: true }
    });
  });
  it.each([
    ['image/png', jpeg.toString('base64')], ['image/jpeg', '!!!'], ['image/jpeg', ''],
    ['image/jpeg', Buffer.alloc(1024 * 1024 + 1).toString('base64')],
    ['image/webp', Buffer.from('RIFF').toString('base64')]
  ])('rejects malformed, oversized or mismatched images (%s)', async (contentType, dataBase64) => {
    await expect(putShelfPhoto('西-北-01', { contentType, dataBase64 }, 'device')).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.mobilePlacementShelfPhoto.upsert).not.toHaveBeenCalled();
  });
  it('accepts exactly 1 MB', async () => {
    const bytes = Buffer.alloc(1024 * 1024); jpeg.copy(bytes);
    await expect(putShelfPhoto('西-北-01', { contentType: 'image/jpeg', dataBase64: bytes.toString('base64') }, 'device')).resolves.toHaveProperty('photoUpdatedAt');
  });
  it('returns the saved photo and reports missing photos', async () => {
    vi.mocked(prisma.mobilePlacementShelfPhoto.findUnique).mockResolvedValueOnce({ bytes: jpeg, contentType: 'image/jpeg' } as never).mockResolvedValueOnce(null);
    expect(await getShelfPhoto('西-北-01')).toMatchObject({ bytes: jpeg, contentType: 'image/jpeg' });
    await expect(getShelfPhoto('西-北-01')).rejects.toMatchObject({ statusCode: 404 });
  });
  it('rejects all operations on an unknown shelf', async () => {
    vi.mocked(prisma.mobilePlacementShelf.findUnique).mockResolvedValue(null);
    await expect(getShelfPhoto('missing')).rejects.toMatchObject({ statusCode: 404 });
    await expect(putShelfPhoto('missing', { contentType: 'image/jpeg', dataBase64: jpeg.toString('base64') }, 'device')).rejects.toMatchObject({ statusCode: 404 });
    await expect(updateShelfMemo('missing', 'memo')).rejects.toMatchObject({ statusCode: 404 });
  });
  it('trims/clears memo without altering photos', async () => {
    await updateShelfMemo('西-北-01', '  南 上段  ');
    expect(prisma.mobilePlacementShelf.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: { displayLabel: '南 上段' } }));
    await updateShelfMemo('西-北-01', null);
    expect(prisma.mobilePlacementShelf.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: { displayLabel: null } }));
    await expect(updateShelfMemo('西-北-01', 'a'.repeat(61))).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.mobilePlacementShelfPhoto.upsert).not.toHaveBeenCalled();
  });
  it('lists nullable photo timestamps and memo', async () => {
    vi.mocked(prisma.mobilePlacementShelf.findMany).mockResolvedValue([
      { shelfCodeRaw: '西-北-01', displayLabel: '南 上段', photo: { updatedAt: stamp } },
      { shelfCodeRaw: '東-南-01', displayLabel: null, photo: null }
    ] as never);
    expect(await listRegisteredShelvesFromShelfMaster()).toEqual([
      expect.objectContaining({ displayLabel: '南 上段', photoUpdatedAt: stamp.toISOString() }),
      expect.objectContaining({ displayLabel: null, photoUpdatedAt: null })
    ]);
  });
  it('creates shelves with optional memo', async () => {
    await registerMobilePlacementShelf({ clientDeviceId: 'device', shelfCodeRaw: 'DAD-3220 北', displayLabel: '  memo  ' });
    expect(prisma.mobilePlacementShelf.create).toHaveBeenCalledWith({ data: { shelfCodeRaw: 'DAD-3220 北', displayLabel: 'memo', createdByClientDeviceId: 'device' } });
  });
});
