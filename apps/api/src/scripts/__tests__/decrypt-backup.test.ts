import { describe, expect, it } from 'vitest';
import { decryptBackupForOutput } from '../decrypt-backup.js';
import { BackupEncryptionError, encryptBackup } from '../../services/backup/storage/backup-encryption.js';

const key = Buffer.alloc(32, 3);
const env = { BACKUP_ENCRYPTION_KEY: key.toString('base64') } as NodeJS.ProcessEnv;
const data = Buffer.from('database dump');

describe('decryptBackupForOutput', () => {
  it('decrypts an encrypted backup with the configured key', () => {
    expect(decryptBackupForOutput(encryptBackup(key, data), env)).toEqual(data);
  });

  it('passes a plaintext backup through unchanged', () => {
    expect(decryptBackupForOutput(data, {} as NodeJS.ProcessEnv)).toEqual(data);
  });

  it('fails without a key or when the data was altered', () => {
    const encrypted = encryptBackup(key, data);
    expect(() => decryptBackupForOutput(encrypted, {} as NodeJS.ProcessEnv)).toThrow(BackupEncryptionError);
    encrypted[encrypted.length - 1] ^= 0xff;
    expect(() => decryptBackupForOutput(encrypted, env)).toThrow();
  });
});
