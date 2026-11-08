#!/usr/bin/env node
/**
 * 暗号化されたバックアップを標準入力から読み、復号した中身を標準出力へ書く。
 * 鍵は稼働中の API と同じ環境変数から読むため、API コンテナ内で動かす。
 *
 * 使用方法(ホスト側):
 *   scripts/server/run-in-active-api.sh node /app/apps/api/dist/scripts/decrypt-backup.js < backup.sql.gz > plain.sql.gz
 *
 * 暗号化されていない入力はそのまま書き出す。鍵が無い、または復号できない場合は終了コード 1。
 */
import {
  BackupEncryptionError,
  decryptBackupIfEncrypted,
  isEncryptedBackup,
  loadBackupEncryptionKey,
} from '../services/backup/storage/backup-encryption.js';

async function readStdin(): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export function decryptBackupForOutput(data: Buffer, env: NodeJS.ProcessEnv = process.env): Buffer {
  if (!isEncryptedBackup(data)) return data;
  const key = loadBackupEncryptionKey(env);
  if (!key) throw new BackupEncryptionError('暗号化の鍵が設定されていません');
  return decryptBackupIfEncrypted(key, data);
}

async function main(): Promise<void> {
  const output = decryptBackupForOutput(await readStdin());
  await new Promise<void>((resolve, reject) => {
    process.stdout.write(output, (error) => (error ? reject(error) : resolve()));
  });
}

const isDirectRun = process.argv[1]?.endsWith('decrypt-backup.js') || process.argv[1]?.endsWith('decrypt-backup.ts');
if (isDirectRun) {
  main().catch((error: unknown) => {
    const message = error instanceof BackupEncryptionError ? error.message : '復号に失敗しました';
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}
