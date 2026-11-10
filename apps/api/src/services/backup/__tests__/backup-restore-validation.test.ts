import { createHash } from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { findFirst, warn } = vi.hoisted(() => ({ findFirst: vi.fn(), warn: vi.fn() }));
vi.mock('../../../lib/prisma.js', () => ({ prisma: { backupHistory: { findFirst } } }));
vi.mock('../../../lib/logger.js', () => ({ logger: { warn } }));

import { validateBackupForRestore } from '../backup-restore-validation.js';
import { encryptBackup } from '../storage/backup-encryption.js';
import { ApiError } from '../../../lib/errors.js';

const key = Buffer.alloc(32, 7);
const plain = Buffer.from('trusted dump');

describe('backup restore trust validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('BACKUP_ENCRYPTION_KEY', key.toString('base64'));
  });
  afterEach(() => vi.unstubAllEnvs());

  it('accepts authenticated encryption without querying history', async () => {
    await expect(validateBackupForRestore(encryptBackup(key, plain))).resolves.toEqual(plain);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it.each(['missing key', 'malformed key', 'wrong key', 'tampered', 'truncated'] as const)('rejects encrypted data with %s', async (scenario) => {
    let raw = encryptBackup(key, plain);
    if (scenario === 'missing key') vi.stubEnv('BACKUP_ENCRYPTION_KEY', '');
    if (scenario === 'malformed key') vi.stubEnv('BACKUP_ENCRYPTION_KEY', Buffer.alloc(8, 1).toString('base64'));
    if (scenario === 'wrong key') vi.stubEnv('BACKUP_ENCRYPTION_KEY', Buffer.alloc(32, 8).toString('base64'));
    if (scenario === 'tampered') raw[21] ^= 0xff;
    if (scenario === 'truncated') {
      raw = raw.subarray(0, 10);
      findFirst.mockResolvedValue(null);
    }
    await expect(validateBackupForRestore(raw)).rejects.toMatchObject({ statusCode: 400, message: 'このバックアップは復元できません' });
    expect(warn).toHaveBeenCalledWith({ reason: expect.any(String) }, expect.any(String));
  });

  it('accepts legacy plaintext only with a matching completed backup hash and no encrypted history', async () => {
    vi.stubEnv('BACKUP_ENCRYPTION_KEY', '');
    findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'matching' });
    await expect(validateBackupForRestore(plain)).resolves.toEqual(plain);
    expect(findFirst).toHaveBeenNthCalledWith(1, {
      where: { operationType: 'BACKUP', status: 'COMPLETED', summary: { path: ['encrypted'], equals: true } },
      select: { id: true }
    });
    expect(findFirst).toHaveBeenNthCalledWith(2, {
      where: { operationType: 'BACKUP', status: 'COMPLETED', hash: createHash('sha256').update(plain).digest('hex') },
      select: { id: true }
    });
  });

  it('rejects plaintext without matching history', async () => {
    findFirst.mockResolvedValue(null);
    await expect(validateBackupForRestore(plain)).rejects.toBeInstanceOf(ApiError);
  });

  it('rejects plaintext once any encrypted backup completed, even if its hash matches', async () => {
    findFirst.mockResolvedValueOnce({ id: 'encrypted' }).mockResolvedValueOnce({ id: 'matching' });
    await expect(validateBackupForRestore(plain)).rejects.toBeInstanceOf(ApiError);
    expect(findFirst).toHaveBeenCalledOnce();
  });
});
