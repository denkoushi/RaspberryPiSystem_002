import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PhotoStorage } from '../../../lib/photo-storage.js';
import { prisma } from '../../../lib/prisma.js';
import { buildPhotoBorrowFingerprint } from '../photo-borrow-idempotency.js';
import { LoanService } from '../loan.service.js';

const mocks = vi.hoisted(() => ({
  findEmployee: vi.fn(),
  runOnce: vi.fn(),
}));

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    loan: { findFirst: vi.fn(), create: vi.fn() },
    transaction: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock('../../../lib/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../../lib/photo-storage.js', () => ({ PhotoStorage: { savePhoto: vi.fn(), deletePhoto: vi.fn() } }));
vi.mock('../../../lib/photo-loan-storage-image.js', () => ({
  preparePhotoAndThumbnailForStorage: vi.fn(async (buffer: Buffer) => ({ originalJpeg: buffer, thumbnailJpeg: buffer })),
}));
vi.mock('../../camera/index.js', () => ({ CameraService: class {} }));
vi.mock('../photo-tool-label/photo-tool-label.scheduler.js', () => ({
  getPhotoToolLabelScheduler: () => ({ runOnce: mocks.runOnce }),
}));
vi.mock('../item.service.js', () => ({ ItemService: class {} }));
vi.mock('../employee.service.js', () => ({
  EmployeeService: class {
    findByNfcTagUid = mocks.findEmployee;
  },
}));

const key = '33333333-3333-4333-8333-333333333333';
const photoData = Buffer.from('jpeg-bytes').toString('base64');
const employee = { id: 'emp-1', employeeCode: '0001', displayName: '山田', nfcTagUid: 'EMP01' };
const savedPhoto = { relativePath: '/api/storage/photos/2026/11/new.jpg', thumbnailRelativePath: '/thumb.jpg' };
const fingerprint = buildPhotoBorrowFingerprint({ employeeTagUid: 'EMP01', imageBuffer: Buffer.from('jpeg-bytes'), note: 'メモ' });
const p2002 = () => new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'test' });

const findFirst = vi.mocked(prisma.loan.findFirst);
const create = vi.mocked(prisma.loan.create);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.findEmployee.mockResolvedValue(employee);
  mocks.runOnce.mockResolvedValue(undefined);
  vi.mocked(PhotoStorage.savePhoto).mockResolvedValue(savedPhoto as never);
  vi.mocked(prisma.$transaction).mockImplementation((async (work: (tx: typeof prisma) => Promise<unknown>) => work(prisma)) as never);
  create.mockImplementation((async ({ data }: { data: Record<string, unknown> }) => ({ id: 'new-loan', ...data })) as never);
});

const borrow = (overrides: Partial<{ idempotencyKey: string; note: string; photoData: string }> = {}, clientId: string | null = 'client-1') =>
  new LoanService().photoBorrow({ employeeTagUid: 'EMP01', photoData, note: 'メモ', idempotencyKey: key, ...overrides }, clientId ?? undefined);

describe('LoanService.photoBorrow idempotency', () => {
  it('requires a resolved client when an Idempotency-Key is sent, before storing any photo', async () => {
    await expect(borrow({}, null)).rejects.toMatchObject({ statusCode: 400 });
    expect(PhotoStorage.savePhoto).not.toHaveBeenCalled();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown employee tag without touching storage', async () => {
    mocks.findEmployee.mockResolvedValue(null);
    await expect(borrow()).rejects.toMatchObject({ statusCode: 404 });
    expect(PhotoStorage.savePhoto).not.toHaveBeenCalled();
  });

  it('stores key and request fingerprint on the first keyed borrow', async () => {
    findFirst.mockResolvedValue(null);
    const loan = await borrow();
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { clientId: 'client-1', photoBorrowIdempotencyKey: key } }));
    expect(loan).toMatchObject({
      id: 'new-loan',
      clientId: 'client-1',
      photoUrl: savedPhoto.relativePath,
      photoBorrowIdempotencyKey: key,
      photoBorrowRequestFingerprint: fingerprint,
      notes: 'メモ',
    });
    expect(prisma.transaction.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      loanId: 'new-loan', action: 'BORROW', actorEmployeeId: 'emp-1', clientId: 'client-1',
    }) });
  });

  it('does not store a fingerprint for unkeyed borrows and skips the replay lookup', async () => {
    const loan = await new LoanService().photoBorrow({ employeeTagUid: 'EMP01', photoData }, 'client-1');
    expect(findFirst).not.toHaveBeenCalled();
    expect(loan).toMatchObject({ photoBorrowIdempotencyKey: undefined, photoBorrowRequestFingerprint: undefined });
  });

  it('returns the stored loan for a matching retry without saving another photo or loan', async () => {
    const stored = { id: 'stored-loan', photoBorrowRequestFingerprint: fingerprint };
    findFirst.mockResolvedValue(stored as never);
    await expect(borrow()).resolves.toBe(stored);
    expect(PhotoStorage.savePhoto).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects a different photo sent under an already used key', async () => {
    findFirst.mockResolvedValue({ id: 'stored-loan', photoBorrowRequestFingerprint: fingerprint } as never);
    await expect(borrow({ photoData: Buffer.from('other-photo').toString('base64') })).rejects.toMatchObject({
      statusCode: 409,
      code: 'IDEMPOTENCY_KEY_REUSED',
    });
    expect(PhotoStorage.savePhoto).not.toHaveBeenCalled();
  });

  it('on a concurrent duplicate (P2002) deletes its own photo and returns the winner', async () => {
    const winner = { id: 'winner-loan', photoBorrowRequestFingerprint: fingerprint };
    findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(winner as never);
    create.mockRejectedValue(p2002());
    await expect(borrow()).resolves.toBe(winner);
    expect(PhotoStorage.deletePhoto).toHaveBeenCalledExactlyOnceWith(savedPhoto.relativePath);
  });

  it('on a concurrent duplicate with a different payload deletes its photo and rejects', async () => {
    findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'winner', photoBorrowRequestFingerprint: 'x'.repeat(64) } as never);
    create.mockRejectedValue(p2002());
    await expect(borrow()).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    expect(PhotoStorage.deletePhoto).toHaveBeenCalledTimes(1);
  });

  it('cleans up the photo and rethrows when the database write fails for another reason', async () => {
    findFirst.mockResolvedValue(null);
    const failure = new Error('db down');
    create.mockRejectedValue(failure);
    await expect(borrow()).rejects.toBe(failure);
    expect(PhotoStorage.deletePhoto).toHaveBeenCalledExactlyOnceWith(savedPhoto.relativePath);
    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  it('still surfaces the original write error when photo cleanup itself fails', async () => {
    findFirst.mockResolvedValue(null);
    const failure = new Error('db down');
    create.mockRejectedValue(failure);
    vi.mocked(PhotoStorage.deletePhoto).mockRejectedValue(new Error('disk'));
    await expect(borrow()).rejects.toBe(failure);
  });

  it('wraps unexpected photo processing errors as 500 and never creates a loan', async () => {
    findFirst.mockResolvedValue(null);
    vi.mocked(PhotoStorage.savePhoto).mockRejectedValue(new Error('disk full'));
    await expect(borrow()).rejects.toMatchObject({ statusCode: 500, message: '写真の処理に失敗しました: disk full' });
    expect(create).not.toHaveBeenCalled();
  });
});
