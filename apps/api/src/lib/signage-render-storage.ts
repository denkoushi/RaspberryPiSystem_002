import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';

const LEGACY_CURRENT_IMAGE_NAME = 'current.jpg';
// 履歴画像の保持設定（デフォルト: 保持しない。10年運用でのストレージ劣化を防ぐため）
const KEEP_HISTORY = process.env.SIGNAGE_RENDER_KEEP_HISTORY === '1';

function getRenderDir(): string {
  return process.env.SIGNAGE_RENDER_DIR || '/opt/RaspberryPiSystem_002/storage/signage-rendered';
}

function legacyCurrentImagePath(): string {
  return path.join(getRenderDir(), LEGACY_CURRENT_IMAGE_NAME);
}

function storageIdForClientKey(clientKey: string): string {
  return createHash('sha256').update(clientKey, 'utf8').digest('hex');
}

function pathForClientCurrentImage(clientKey: string): string {
  return path.join(getRenderDir(), `current-${storageIdForClientKey(clientKey)}.jpg`);
}

export class SignageRenderStorage {
  static async initialize(): Promise<void> {
    await fs.mkdir(getRenderDir(), { recursive: true });
  }

  /**
   * 端末（apiKey）ごとに latest JPEG を保存する
   */
  static async saveRenderedImageForClient(
    buffer: Buffer,
    clientKey: string,
  ): Promise<{
    filename: string;
    filePath: string;
  }> {
    await fs.mkdir(getRenderDir(), { recursive: true });

    const filePath = pathForClientCurrentImage(clientKey);
    await fs.writeFile(filePath, buffer);

    let filename = path.basename(filePath);
    if (KEEP_HISTORY) {
      filename = `signage_${storageIdForClientKey(clientKey)}_${Date.now()}.jpg`;
      const historyPath = path.join(getRenderDir(), filename);
      await fs.writeFile(historyPath, buffer);
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
    await fs.mkdir(getRenderDir(), { recursive: true });
    await fs.writeFile(legacyPath, buffer);
    return { filename: LEGACY_CURRENT_IMAGE_NAME, filePath: legacyPath };
  }

  /**
   * 端末キーがあるときはその端末用ファイル。無いときはレガシー current.jpg（存在すれば）
   */
  static async readCurrentImage(clientKey?: string | null): Promise<Buffer | null> {
    if (clientKey && clientKey.length > 0) {
      try {
        return await fs.readFile(pathForClientCurrentImage(clientKey));
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

  static getCurrentImagePathForClient(clientKey: string): string {
    return pathForClientCurrentImage(clientKey);
  }

  /** @deprecated 端末別パスを優先。JWT のみ等で引き続き参照 */
  static getLegacyGlobalImagePath(): string {
    return legacyCurrentImagePath();
  }
}
