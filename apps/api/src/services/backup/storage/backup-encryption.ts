import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { createReadStream, createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { Transform } from 'stream';

/**
 * 外部ストレージ（Dropbox）へ送るバックアップの暗号化形式。
 *
 * 形式: MAGIC(8) | IV(12) | AES-256-GCM 暗号文 | 認証タグ(16)
 * MAGICで暗号化済みかを判定するため、既存の平文バックアップもそのまま復元できる。
 */
export const BACKUP_ENCRYPTION_MAGIC = Buffer.from('RPBKENC1', 'ascii');
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const ALGORITHM = 'aes-256-gcm';
/** 暗号化で増えるバイト数（MAGIC + IV + 認証タグ） */
export const BACKUP_ENCRYPTION_OVERHEAD_BYTES = BACKUP_ENCRYPTION_MAGIC.length + IV_LENGTH + TAG_LENGTH;

export class BackupEncryptionError extends Error {}

/**
 * `BACKUP_ENCRYPTION_KEY`（32バイトのbase64）を読む。未設定なら undefined。
 */
export function loadBackupEncryptionKey(env: NodeJS.ProcessEnv = process.env): Buffer | undefined {
  const raw = env.BACKUP_ENCRYPTION_KEY?.trim();
  if (!raw) {
    return undefined;
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== KEY_LENGTH) {
    throw new BackupEncryptionError('BACKUP_ENCRYPTION_KEY must be 32 bytes encoded as base64');
  }
  return key;
}

export function isEncryptedBackup(data: Buffer): boolean {
  return (
    data.length >= BACKUP_ENCRYPTION_MAGIC.length + IV_LENGTH + TAG_LENGTH &&
    data.subarray(0, BACKUP_ENCRYPTION_MAGIC.length).equals(BACKUP_ENCRYPTION_MAGIC)
  );
}

export function encryptBackup(key: Buffer, data: Buffer): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const body = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.concat([BACKUP_ENCRYPTION_MAGIC, iv, body, cipher.getAuthTag()]);
}

/**
 * 暗号化済みなら復号し、平文（暗号化導入前のバックアップ）ならそのまま返す。
 */
export function decryptBackupIfEncrypted(key: Buffer | undefined, data: Buffer): Buffer {
  if (!isEncryptedBackup(data)) {
    return data;
  }
  if (!key) {
    throw new BackupEncryptionError('Backup is encrypted but BACKUP_ENCRYPTION_KEY is not set');
  }
  const headerLength = BACKUP_ENCRYPTION_MAGIC.length + IV_LENGTH;
  const iv = data.subarray(BACKUP_ENCRYPTION_MAGIC.length, headerLength);
  const tag = data.subarray(data.length - TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(data.subarray(headerLength, data.length - TAG_LENGTH)), decipher.final()]);
  } catch {
    throw new BackupEncryptionError('Backup decryption failed (wrong key or corrupted data)');
  }
}

/**
 * 大容量バックアップ（DBダンプ等）をメモリに載せずに暗号化してファイルへ書き出す。
 */
export async function encryptBackupFile(key: Buffer, sourcePath: string, destinationPath: string): Promise<void> {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const output = createWriteStream(destinationPath, { mode: 0o600 });
  output.write(Buffer.concat([BACKUP_ENCRYPTION_MAGIC, iv]));
  const appendTag = new Transform({
    transform(chunk, _encoding, callback) {
      callback(null, chunk);
    },
    flush(callback) {
      callback(null, cipher.getAuthTag());
    }
  });
  await pipeline(createReadStream(sourcePath), cipher, appendTag, output);
}
