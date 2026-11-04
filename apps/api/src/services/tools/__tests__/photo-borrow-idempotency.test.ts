import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PhotoStorage } from '../../../lib/photo-storage.js';
import {
  assertMatchingPhotoBorrowRequest,
  buildPhotoBorrowFingerprint,
  cleanupUncommittedPhoto,
} from '../photo-borrow-idempotency.js';

vi.mock('../../../lib/photo-storage.js', () => ({ PhotoStorage: { deletePhoto: vi.fn() } }));

const image = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

beforeEach(() => {
  vi.resetAllMocks();
});

describe('buildPhotoBorrowFingerprint', () => {
  it('is a stable sha256 hex digest for identical requests', () => {
    const a = buildPhotoBorrowFingerprint({ employeeTagUid: 'EMP01', imageBuffer: image, note: 'メモ' });
    const b = buildPhotoBorrowFingerprint({ employeeTagUid: 'EMP01', imageBuffer: Buffer.from(image), note: 'メモ' });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('ignores surrounding whitespace in tag UID and note (retry from the same kiosk)', () => {
    const base = buildPhotoBorrowFingerprint({ employeeTagUid: 'EMP01', imageBuffer: image, note: 'メモ' });
    expect(buildPhotoBorrowFingerprint({ employeeTagUid: '  EMP01\n', imageBuffer: image, note: ' メモ ' })).toBe(base);
  });

  it('treats a missing, null and blank note the same', () => {
    const none = buildPhotoBorrowFingerprint({ employeeTagUid: 'EMP01', imageBuffer: image });
    expect(buildPhotoBorrowFingerprint({ employeeTagUid: 'EMP01', imageBuffer: image, note: null })).toBe(none);
    expect(buildPhotoBorrowFingerprint({ employeeTagUid: 'EMP01', imageBuffer: image, note: '   ' })).toBe(none);
  });

  it('changes when the employee, note or a single image byte changes', () => {
    const base = buildPhotoBorrowFingerprint({ employeeTagUid: 'EMP01', imageBuffer: image, note: 'メモ' });
    expect(buildPhotoBorrowFingerprint({ employeeTagUid: 'EMP02', imageBuffer: image, note: 'メモ' })).not.toBe(base);
    expect(buildPhotoBorrowFingerprint({ employeeTagUid: 'EMP01', imageBuffer: image, note: 'メモ2' })).not.toBe(base);
    const altered = Buffer.from(image);
    altered[altered.length - 1] ^= 1;
    expect(buildPhotoBorrowFingerprint({ employeeTagUid: 'EMP01', imageBuffer: altered, note: 'メモ' })).not.toBe(base);
  });

  it('separates fields so moving text between UID and note does not collide', () => {
    const a = buildPhotoBorrowFingerprint({ employeeTagUid: 'AB', imageBuffer: image, note: 'C' });
    const b = buildPhotoBorrowFingerprint({ employeeTagUid: 'A', imageBuffer: image, note: 'BC' });
    expect(a).not.toBe(b);
  });
});

describe('assertMatchingPhotoBorrowRequest', () => {
  it('accepts a replay whose fingerprint matches the stored loan', () => {
    expect(() => assertMatchingPhotoBorrowRequest({ photoBorrowRequestFingerprint: 'abc' }, 'abc')).not.toThrow();
  });

  it('rejects a different request under the same idempotency key with 409 IDEMPOTENCY_KEY_REUSED', () => {
    expect(() => assertMatchingPhotoBorrowRequest({ photoBorrowRequestFingerprint: 'abc' }, 'def')).toThrow(
      expect.objectContaining({ statusCode: 409, code: 'IDEMPOTENCY_KEY_REUSED' }),
    );
  });

  it('rejects when the stored loan has no fingerprint (legacy row without request hash)', () => {
    expect(() => assertMatchingPhotoBorrowRequest({ photoBorrowRequestFingerprint: null }, 'abc')).toThrow(
      expect.objectContaining({ code: 'IDEMPOTENCY_KEY_REUSED' }),
    );
  });
});

describe('cleanupUncommittedPhoto', () => {
  it('deletes the saved photo when the loan was not committed', async () => {
    await cleanupUncommittedPhoto('/api/storage/photos/2026/11/a.jpg');
    expect(PhotoStorage.deletePhoto).toHaveBeenCalledExactlyOnceWith('/api/storage/photos/2026/11/a.jpg');
  });

  it.each([null, undefined, ''])('does nothing for %j', async (url) => {
    await cleanupUncommittedPhoto(url);
    expect(PhotoStorage.deletePhoto).not.toHaveBeenCalled();
  });
});
