import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { getFileStorageRoot } from '../services/file-storage/file-storage-config.js';
import { writeAtomicFileAtRoot } from '../services/file-storage/secure-atomic-file.js';

const LEGACY_CURRENT_IMAGE_NAME = 'current.jpg';
// 履歴画像の保持設定（デフォルト: 保持しない。10年運用でのストレージ劣化を防ぐため）
const KEEP_HISTORY = process.env.SIGNAGE_RENDER_KEEP_HISTORY === '1';

function getRenderDir(): string {
  return process.env.SIGNAGE_RENDER_DIR || path.join(getFileStorageRoot(), 'signage-rendered');
}

function legacyCurrentImagePath(): string {
  return path.join(getRenderDir(), LEGACY_CURRENT_IMAGE_NAME);
}

function storageIdForClientDeviceId(clientDeviceId: string): string {
  return createHash('sha256').update(clientDeviceId, 'utf8').digest('hex');
}

function pathForClientCurrentImage(clientDeviceId: string): string {
  return path.join(getRenderDir(), `current-${storageIdForClientDeviceId(clientDeviceId)}.jpg`);
}

export class SignageRenderStorage {
  static async initialize(): Promise<void> {
    await fs.mkdir(getRenderDir(), { recursive: true });
  }

  /**
   * 端末 IDごとに latest JPEG を保存する
   */
  static async saveRenderedImageForClient(
    buffer: Buffer,
    clientDeviceId: string,
  ): Promise<{
    filename: string;
    filePath: string;
  }> {
    const filePath = pathForClientCurrentImage(clientDeviceId);
    await writeAtomicFileAtRoot(getRenderDir(), path.basename(filePath), buffer, 'replace');

    let filename = path.basename(filePath);
    if (KEEP_HISTORY) {
      filename = `signage_${storageIdForClientDeviceId(clientDeviceId)}_${Date.now()}.jpg`;
      const historyPath = path.join(getRenderDir(), filename);
      await writeAtomicFileAtRoot(getRenderDir(), filename, buffer, 'create');
      return { filename, filePath: historyPath };
    }

    return { filename, filePath };
  }

  /**
   * ClientDevice が0件のとき等、レンダラが単一キャッシュだけ更新する場合用（後方互換・管理プレビュー）
   */
  static async saveLegacyGlobalImage(buffer: Buffer): Promise<{
    filename: string;
    filePath: string;
  }> {
    const legacyPath = legacyCurrentImagePath();
    await writeAtomicFileAtRoot(
      getRenderDir(),
      LEGACY_CURRENT_IMAGE_NAME,
      buffer,
      'replace'
    );
    return { filename: LEGACY_CURRENT_IMAGE_NAME, filePath: legacyPath };
  }

  /**
   * 端末 ID があるときはその端末用ファイル。無いときはレガシー current.jpg（存在すれば）
   */
  static async readCurrentImage(clientDeviceId?: string | null): Promise<Buffer | null> {
    if (clientDeviceId && clientDeviceId.length > 0) {
      try {
        return await fs.readFile(pathForClientCurrentImage(clientDeviceId));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return null;
        }
        throw error;
      }
    }
    try {
      return await fs.readFile(legacyCurrentImagePath());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  static getCurrentImagePathForClient(clientDeviceId: string): string {
    return pathForClientCurrentImage(clientDeviceId);
  }

  /** @deprecated 端末別パスを優先。JWT のみ等で引き続き参照 */
  static getLegacyGlobalImagePath(): string {
    return legacyCurrentImagePath();
  }
}
