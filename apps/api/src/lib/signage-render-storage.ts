import { promises as fs } from 'fs';
import path from 'path';

const STORAGE_BASE_DIR = process.env.SIGNAGE_RENDER_DIR || '/opt/RaspberryPiSystem_002/storage/signage-rendered';
const RENDER_DIR = STORAGE_BASE_DIR;
const CURRENT_IMAGE_NAME = 'current.jpg';
const CURRENT_IMAGE_PATH = path.join(RENDER_DIR, CURRENT_IMAGE_NAME);

export class SignageRenderStorage {
  static async initialize(): Promise<void> {
    await fs.mkdir(RENDER_DIR, { recursive: true });
  }

  static async saveRenderedImage(buffer: Buffer): Promise<{
    filename: string;
    filePath: string;
  }> {
    await fs.mkdir(RENDER_DIR, { recursive: true });
    const filename = `signage_${Date.now()}.jpg`;
    const filePath = path.join(RENDER_DIR, filename);
    await fs.writeFile(filePath, buffer);
    await fs.writeFile(CURRENT_IMAGE_PATH, buffer);
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

