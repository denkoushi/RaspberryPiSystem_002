import sharp from 'sharp';
import type { CameraDriver } from './camera-driver.interface.js';

/**
 * モックカメラドライバー（テスト用）
 * 
 * 実際のカメラハードウェアが不要な環境（開発環境、CI環境など）で使用する。
 * sharpを使用してダミーの画像データを生成する。
 */
export class MockCameraDriver implements CameraDriver {
  private initialized = false;

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async capture(): Promise<Buffer> {
    if (!this.initialized) {
      throw new Error('Camera not initialized. Call initialize() first.');
    }

    // sharpを使用してダミーのJPEG画像を生成（800x600px、JPEG品質80%相当）
    // グレースケールのグラデーション画像を生成
    const width = 800;
    const height = 600;
    
    // SVG形式でグラデーション画像を生成してからJPEGに変換
    const svg = `
      <svg width="${width}" height="${height}">
        <defs>
          <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:#cccccc;stop-opacity:1" />
            <stop offset="100%" style="stop-color:#888888;stop-opacity:1" />
          </linearGradient>
        </defs>
        <rect width="${width}" height="${height}" fill="url(#grad)" />
        <text x="50%" y="50%" font-family="Arial" font-size="24" fill="white" text-anchor="middle" dominant-baseline="middle">
          Mock Camera Image
        </text>
      </svg>
    `;

    return await sharp(Buffer.from(svg))
      .resize(width, height)
      .jpeg({ quality: 80 })
      .toBuffer();
  }

  async release(): Promise<void> {
    this.initialized = false;
  }

  async isAvailable(): Promise<boolean> {
    return true; // モックは常に利用可能
  }
}

