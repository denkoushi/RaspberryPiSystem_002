import { Prisma, TransactionAction } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../lib/errors.js';
import { logger } from '../../../lib/logger.js';
import { prisma } from '../../../lib/prisma.js';
import { PhotoStorage } from '../../../lib/photo-storage.js';
import { preparePhotoAndThumbnailForStorage } from '../../../lib/photo-loan-storage-image.js';
import { LoanService } from '../loan.service.js';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    loan: { findFirst: vi.fn(), create: vi.fn() },
    transaction: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock('../../../lib/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../../lib/photo-storage.js', () => ({
  PhotoStorage: { savePhoto: vi.fn(), deletePhoto: vi.fn() },
}));
vi.mock('../../../lib/photo-loan-storage-image.js', () => ({
  preparePhotoAndThumbnailForStorage: vi.fn(),
}));
vi.mock('../../camera/index.js', () => ({ CameraService: class {} }));
vi.mock('../item.service.js', () => ({ ItemService: class {} }));
const { findEmployee, runOnce } = vi.hoisted(() => ({ findEmployee: vi.fn(), runOnce: vi.fn() }));
vi.mock('../employee.service.js', () => ({ EmployeeService: class { findByNfcTagUid = findEmployee; } }));
vi.mock('../photo-tool-label/photo-tool-label.scheduler.js', () => ({
  getPhotoToolLabelScheduler: vi.fn(() => ({ runOnce })),
}));

const now = new Date('2026-11-03T12:00:00.000Z');
const photoData = Buffer.from('raw-jpeg').toString('base64');
const employee = { id: 'emp-1', employeeCode: 'E001', displayName: '山田', nfcTagUid: 'EMPTAG' };
const photoUrl = '/api/storage/photos/2026/11/20261103_120000_emp-1.jpg';

function p2002() {
  return new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'test' });
}

// Idempotency replay/conflict paths are covered by loan-photo-borrow-idempotency.test.ts;
// this file pins the persisted payload and error/side-effect edges around them.
describe('LoanService.photoBorrow', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(now);
    findEmployee.mockResolvedValue(employee);
    runOnce.mockResolvedValue(undefined);
    vi.mocked(preparePhotoAndThumbnailForStorage).mockResolvedValue({
      originalJpeg: Buffer.from('orig'),
      thumbnailJpeg: Buffer.from('thumb'),
    });
    vi.mocked(PhotoStorage.savePhoto).mockResolvedValue({ relativePath: photoUrl, thumbnailRelativePath: '/t.jpg' } as never);
    vi.mocked(prisma.$transaction).mockImplementation(
      (async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma)) as never,
    );
    vi.mocked(prisma.loan.create).mockImplementation((async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'loan-1',
      ...data,
    })) as never);
    vi.mocked(prisma.transaction.create).mockResolvedValue({ id: 'tx-1' } as never);
  });
  afterEach(() => vi.useRealTimers());

  it('アイテム無しで写真付きloanとBORROW取引を作成し、ラベル推定を起動する', async () => {
    const loan = await new LoanService().photoBorrow({ employeeTagUid: 'EMPTAG', photoData, note: '棚A' }, 'client-1');

    expect(preparePhotoAndThumbnailForStorage).toHaveBeenCalledWith(Buffer.from('raw-jpeg'));
    expect(PhotoStorage.savePhoto).toHaveBeenCalledWith('emp-1', Buffer.from('orig'), Buffer.from('thumb'));
    expect(prisma.loan.create).toHaveBeenCalledWith({
      data: {
        itemId: null,
        employeeId: 'emp-1',
        clientId: 'client-1',
        photoUrl,
        photoTakenAt: now,
        photoToolLabelRequested: true,
        photoBorrowIdempotencyKey: undefined,
        photoBorrowRequestFingerprint: undefined,
        notes: '棚A',
      },
      include: { item: true, employee: true, client: true },
    });
    expect(prisma.transaction.create).toHaveBeenCalledWith({
      data: {
        loanId: 'loan-1',
        action: TransactionAction.BORROW,
        actorEmployeeId: 'emp-1',
        clientId: 'client-1',
        details: {
          note: '棚A',
          employeeSnapshot: { id: 'emp-1', code: 'E001', name: '山田', nfcTagUid: 'EMPTAG' },
          photoUrl,
          photoTakenAt: now.toISOString(),
        },
      },
    });
    expect(loan).toMatchObject({ id: 'loan-1', itemId: null, photoUrl });
    expect(runOnce).toHaveBeenCalledTimes(1);
    expect(prisma.loan.findFirst).not.toHaveBeenCalled();
    expect(PhotoStorage.deletePhoto).not.toHaveBeenCalled();
  });

  it('写真保存でApiErrorが出た場合はそのまま返す', async () => {
    const quota = new ApiError(507, 'storage full');
    vi.mocked(PhotoStorage.savePhoto).mockRejectedValue(quota);
    await expect(new LoanService().photoBorrow({ employeeTagUid: 'EMPTAG', photoData }, 'client-1')).rejects.toBe(quota);
  });

  it('Idempotency-Key無しの一意制約違反は再照会せずそのまま投げる', async () => {
    const error = p2002();
    vi.mocked(prisma.loan.create).mockRejectedValue(error);
    await expect(new LoanService().photoBorrow({ employeeTagUid: 'EMPTAG', photoData }, 'client-1')).rejects.toBe(error);
    expect(prisma.loan.findFirst).not.toHaveBeenCalled();
    expect(PhotoStorage.deletePhoto).toHaveBeenCalledWith(photoUrl);
  });

  it('Idempotency-Keyがあっても一意制約違反以外のエラーでは再照会しない', async () => {
    const error = new Error('deadlock');
    vi.mocked(prisma.loan.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.loan.create).mockRejectedValue(error);
    await expect(
      new LoanService().photoBorrow(
        { employeeTagUid: 'EMPTAG', photoData, idempotencyKey: '33333333-3333-4333-8333-333333333333' },
        'client-1',
      ),
    ).rejects.toBe(error);
    expect(prisma.loan.findFirst).toHaveBeenCalledTimes(1);
  });

  it('ラベル推定の起動失敗は持出結果に影響しない', async () => {
    runOnce.mockRejectedValue(new Error('scheduler busy'));
    await expect(
      new LoanService().photoBorrow({ employeeTagUid: 'EMPTAG', photoData }, 'client-1'),
    ).resolves.toMatchObject({ id: 'loan-1' });
    await vi.waitFor(() =>
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ loanId: 'loan-1' }),
        'Photo tool label scheduler kick after borrow failed',
      ),
    );
  });
});
