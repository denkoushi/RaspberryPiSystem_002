import { createHash } from 'node:crypto';
import type { Loan } from '@prisma/client';
import { ApiError } from '../../lib/errors.js';
import { PhotoStorage } from '../../lib/photo-storage.js';

export function buildPhotoBorrowFingerprint(input: {
  employeeTagUid: string;
  imageBuffer: Buffer;
  note?: string | null;
}): string {
  const imageHash = createHash('sha256').update(input.imageBuffer).digest('hex');
  return createHash('sha256')
    .update(input.employeeTagUid.trim())
    .update('\0')
    .update(input.note?.trim() ?? '')
    .update('\0')
    .update(imageHash)
    .digest('hex');
}

export function assertMatchingPhotoBorrowRequest(
  loan: Pick<Loan, 'photoBorrowRequestFingerprint'>,
  fingerprint: string,
): void {
  if (loan.photoBorrowRequestFingerprint !== fingerprint) {
    throw new ApiError(
      409,
      '同じ冪等キーが異なる写真持出リクエストに使用されました',
      undefined,
      'IDEMPOTENCY_KEY_REUSED',
    );
  }
}

export async function cleanupUncommittedPhoto(photoUrl: string | null | undefined): Promise<void> {
  if (!photoUrl) return;
  await PhotoStorage.deletePhoto(photoUrl);
}
