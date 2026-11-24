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
  if (!trimmed || trimmed.includes('\0') || path.isAbsolute(trimmed) || path.win32.isAbsolute(trimmed)) throw invalid();
  if (trimmed.split(/[\\/]/).some((segment) => segment === '..')) throw invalid();
  const fullPath = path.resolve(root, trimmed);
  if (!fullPath.startsWith(root + path.sep)) throw invalid();
  return fullPath;
}
