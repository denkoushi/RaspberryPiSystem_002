import { constants, promises as fs } from 'fs';
import path from 'path';
import { ApiError } from '../../lib/errors.js';
import { getDefaultBaseDir } from './storage/local-storage.provider.js';

export const RESTORE_DESTINATION_DIR_NAME = 'restored';

/**
 * 復元先の指定を、バックアップ保存先の `restored/` 配下の実パスに解決する。
 * 絶対パス・親参照・NUL を含む指定や、配下から外れる指定は 400 にする。
 */
export function resolveRestoreDestination(destination: string, baseDir: string = getDefaultBaseDir()): string {
  const root = path.resolve(baseDir, RESTORE_DESTINATION_DIR_NAME);
  const trimmed = destination.trim();
  const invalid = () => new ApiError(400, '復元先はバックアップ保存先の restored 配下の相対パスで指定してください');
  if (!trimmed || /[\\/]$/.test(trimmed) || trimmed.includes('\0') || path.isAbsolute(trimmed) || path.win32.isAbsolute(trimmed)) throw invalid();
  if (trimmed.split(/[\\/]/).some((segment) => segment === '..')) throw invalid();
  const fullPath = path.resolve(root, trimmed);
  if (!fullPath.startsWith(root + path.sep)) throw invalid();
  return fullPath;
}

/**
 * resolveRestoreDestination で得たパスへ書き込む。途中のフォルダや書き込み先がリンクで
 * restored/ の外を指す場合と、既存のフォルダを指す場合は 400 にする。
 */
export async function writeRestoredFile(fullPath: string, data: Buffer, baseDir: string = getDefaultBaseDir()): Promise<void> {
  const root = path.resolve(baseDir, RESTORE_DESTINATION_DIR_NAME);
  const invalid = () => new ApiError(400, '復元先に書き込めません');
  await fs.mkdir(root, { recursive: true });
  if ((await fs.lstat(root)).isSymbolicLink()) throw invalid();
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  const realRoot = await fs.realpath(root);
  const realDir = await fs.realpath(path.dirname(fullPath));
  if (realDir !== realRoot && !realDir.startsWith(realRoot + path.sep)) throw invalid();
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(
      path.join(realDir, path.basename(fullPath)),
      constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW,
      0o600,
    );
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ELOOP' || code === 'EISDIR' || code === 'EMLINK') throw invalid();
    throw error;
  }
  try {
    await handle.chmod(0o600);
    await handle.writeFile(data);
  } finally {
    await handle.close();
  }
}
