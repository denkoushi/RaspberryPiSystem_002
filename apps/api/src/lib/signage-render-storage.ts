import { promises as fs } from 'fs';
import path from 'path';

const STORAGE_BASE_DIR = process.env.SIGNAGE_RENDER_DIR || '/opt/RaspberryPiSystem_002/storage/signage-rendered';
const RENDER_DIR = STORAGE_BASE_DIR;
const CURRENT_IMAGE_NAME = 'current.jpg';
const CURRENT_IMAGE_PATH = path.join(RENDER_DIR, CURRENT_IMAGE_NAME);
// 履歴画像の保持設定（デフォルト: 保持しない。10年運用でのストレージ劣化を防ぐため）
const KEEP_HISTORY = process.env.SIGNAGE_RENDER_KEEP_HISTORY === '1';

export class SignageRenderStorage {
  static async initialize(): Promise<void> {
    await fs.mkdir(RENDER_DIR, { recursive: true });
  }

  static async saveRenderedImage(buffer: Buffer): Promise<{
    filename: string;
    filePath: string;
  }> {
    await fs.mkdir(RENDER_DIR, { recursive: true });
    
    // current.jpgは常に保存（運用上必要）
    await fs.writeFile(CURRENT_IMAGE_PATH, buffer);
    
    // 履歴画像は環境変数で有効化された場合のみ保存（デフォルト: 保存しない）
    let filename = CURRENT_IMAGE_NAME;
    let filePath = CURRENT_IMAGE_PATH;
    
    if (KEEP_HISTORY) {
      filename = `signage_${Date.now()}.jpg`;
      filePath = path.join(RENDER_DIR, filename);
      await fs.writeFile(filePath, buffer);
    }
    
    return { filename, filePath };
  }

  static async readCurrentImage(): Promise<Buffer | null> {
    try {
      return await fs.readFile(CURRENT_IMAGE_PATH);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  static getCurrentImagePath(): string {
    return CURRENT_IMAGE_PATH;
  }
}

