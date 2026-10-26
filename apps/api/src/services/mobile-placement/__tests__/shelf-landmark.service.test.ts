import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import { listMachinesForShelfRegistration } from '../machine-master-query.service.js';
import { addShelfLandmark, deleteShelfLandmark, listShelfLandmarks } from '../shelf-landmark.service.js';

vi.mock('../../../lib/prisma.js', () => ({ prisma: {
  mobilePlacementShelfLandmark: { create: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() },
  mobilePlacementShelf: { count: vi.fn() },
  $transaction: vi.fn()
} }));
vi.mock('../machine-master-query.service.js', () => ({ listMachinesForShelfRegistration: vi.fn() }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listMachinesForShelfRegistration).mockResolvedValue({ machines: ['DAD-3220'] });
  vi.mocked(prisma.$transaction).mockImplementation(async (callback) => callback(prisma as unknown as Prisma.TransactionClient));
});

describe('shelf landmarks', () => {
  it('lists individually registered names', async () => {
    vi.mocked(prisma.mobilePlacementShelfLandmark.findMany).mockResolvedValue([{ name: '電気室' }] as never);
    await expect(listShelfLandmarks()).resolves.toEqual(['電気室']);
  });
  it.each([' 電気室 ', '倉'.repeat(30)])('trims and creates %s', async (name) => {
    await expect(addShelfLandmark(name, 'client')).resolves.toEqual({ name: name.trim() });
    expect(prisma.mobilePlacementShelfLandmark.create).toHaveBeenCalledWith({ data: { name: name.trim(), createdByClientDeviceId: 'client' } });
  });
  it.each(['', '   ', '倉'.repeat(31)])('rejects invalid name %s', async (name) => {
    await expect(addShelfLandmark(name, 'client')).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.mobilePlacementShelfLandmark.create).not.toHaveBeenCalled();
  });
  it.each(['電気室 北', '倉庫 南東', '西-北-02'])('rejects a name that reads as a shelf name %s', async (name) => {
    await expect(addShelfLandmark(name, 'client')).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.mobilePlacementShelfLandmark.create).not.toHaveBeenCalled();
  });
  it('turns a concurrent delete conflict into 409', async () => {
    vi.mocked(prisma.$transaction).mockRejectedValue(new Prisma.PrismaClientKnownRequestError('conflict', { code: 'P2034', clientVersion: '7' }));
    await expect(deleteShelfLandmark('電気室')).rejects.toMatchObject({ statusCode: 409 });
  });
  it('rejects a machine name collision', async () => {
    await expect(addShelfLandmark(' DAD-3220 ', 'client')).rejects.toMatchObject({ statusCode: 409, message: '加工機と同じ名前は使えません' });
    expect(prisma.mobilePlacementShelfLandmark.create).not.toHaveBeenCalled();
  });
  it('rejects duplicates including concurrent inserts', async () => {
    vi.mocked(prisma.mobilePlacementShelfLandmark.create).mockRejectedValue(new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '7' }));
    await expect(addShelfLandmark('電気室', 'client')).rejects.toMatchObject({ statusCode: 409, message: 'この目安はもうあります' });
  });
  it('does not create when machine validation is unavailable', async () => {
    vi.mocked(listMachinesForShelfRegistration).mockRejectedValue(new Error('offline'));
    await expect(addShelfLandmark('電気室', 'client')).rejects.toMatchObject({ statusCode: 503 });
    expect(prisma.mobilePlacementShelfLandmark.create).not.toHaveBeenCalled();
  });
  it.each(['電気室', '電気室 北西', '電気室 北', '電気室 北東', '電気室 西', '電気室 東', '電気室 南西', '電気室 南', '電気室 南東'])('refuses deletion when %s exists', async (shelfCodeRaw) => {
    vi.mocked(prisma.mobilePlacementShelf.count).mockImplementation(async (args) => {
      const filter = args?.where?.shelfCodeRaw as { in: string[] };
      return filter.in.includes(shelfCodeRaw) ? 1 : 0;
    });
    await expect(deleteShelfLandmark('電気室')).rejects.toMatchObject({ statusCode: 409 });
    expect(prisma.mobilePlacementShelfLandmark.deleteMany).not.toHaveBeenCalled();
  });
  it('deletes an unused name without prefix matching other landmarks', async () => {
    vi.mocked(prisma.mobilePlacementShelf.count).mockImplementation(async (args) => {
      const filter = args?.where?.shelfCodeRaw as { in: string[] };
      return filter.in.includes('電気室 倉庫 南東') ? 1 : 0;
    });
    vi.mocked(prisma.mobilePlacementShelfLandmark.deleteMany).mockResolvedValue({ count: 1 });
    await expect(deleteShelfLandmark('電気室')).resolves.toEqual({ name: '電気室' });
    expect(prisma.mobilePlacementShelfLandmark.deleteMany).toHaveBeenCalledWith({ where: { name: '電気室' } });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
  });
  it('returns 404 for a missing name', async () => {
    vi.mocked(prisma.mobilePlacementShelf.count).mockResolvedValue(0);
    vi.mocked(prisma.mobilePlacementShelfLandmark.deleteMany).mockResolvedValue({ count: 0 });
    await expect(deleteShelfLandmark('不存在')).rejects.toMatchObject({ statusCode: 404 });
  });
});
