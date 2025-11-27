import sharp from 'sharp';
import { cameraConfig } from '../../config/camera.config.js';
import type { CameraDriver } from './drivers/camera-driver.interface.js';
import { MockCameraDriver, USBCameraDriver } from './drivers/index.js';

export interface CaptureOptions {
  retryCount?: number; // リトライ回数（デフォルト: 3）
}

export interface CaptureResult {
  original: Buffer; // 元画像（リサイズ済み）
  thumbnail: Buffer; // サムネイル
}

/**
 * 共通カメラサービス
 * 
 * カメラドライバーを抽象化し、撮影・リサイズ・サムネイル生成を提供する。
 * カメラタイプに依存しない統一的なインターフェースを提供する。
 */
export class CameraService {
  private driver: CameraDriver;
  private initialized = false;

  constructor(driver?: CameraDriver) {
    // ドライバーが指定されていない場合は、設定に基づいて選択
    if (driver) {
      this.driver = driver;
    } else {
      this.driver = this.createDriver();
    }
  }

  /**
   * 設定に基づいてカメラドライバーを作成する
   */
  private createDriver(): CameraDriver {
    switch (cameraConfig.type) {
      case 'raspberry-pi-camera':
        // TODO: Raspberry Pi Camera Module ドライバーを実装
        throw new Error('Raspberry Pi Camera Module driver is not yet implemented');
      case 'usb-camera':
        return new USBCameraDriver(cameraConfig.device);
      case 'mock':
      default:
        return new MockCameraDriver();
    }
  }

  /**
   * カメラを初期化する
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    const isAvailable = await this.driver.isAvailable();
    if (!isAvailable) {
      throw new Error('Camera is not available');
    }

    await this.driver.initialize();
    this.initialized = true;
  }

  /**
   * 写真を撮影し、リサイズ・サムネイル生成を行う
   * 
   * @param options 撮影オプション（リトライ回数など）
   * @returns 元画像とサムネイルのBuffer
   * @throws {Error} 撮影に失敗した場合（リトライ後も失敗）
   */
  async captureAndProcess(options: CaptureOptions = {}): Promise<CaptureResult> {
    const retryCount = options.retryCount ?? 3;
    let lastError: Error | null = null;

    // リトライ処理
    for (let attempt = 1; attempt <= retryCount; attempt++) {
      try {
        if (!this.initialized) {
          await this.initialize();
        }

        // カメラから画像を取得
        const rawImage = await this.driver.capture();

        // 画像をリサイズ（元画像）
        const resizedImage = await this.resizeImage(
          rawImage,
          cameraConfig.resolution.width,
          cameraConfig.resolution.height,
          cameraConfig.quality
        );

        // サムネイルを生成
        const thumbnail = await this.generateThumbnail(resizedImage);

        return {
          original: resizedImage,
          thumbnail,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        // 最後の試行でない場合は、少し待ってからリトライ
        if (attempt < retryCount) {
          await new Promise(resolve => setTimeout(resolve, 100 * attempt)); // 100ms, 200ms, 300ms...
          continue;
        }
      }
    }

    // すべてのリトライが失敗した場合
    throw new Error(`Failed to capture image after ${retryCount} attempts: ${lastError?.message ?? 'Unknown error'}`);
  }

  /**
   * 画像をリサイズする
   * 
   * @param image 元画像のBuffer
   * @param width 幅（px）
   * @param height 高さ（px）
   * @param quality JPEG品質（0-100）
   * @returns リサイズされた画像のBuffer
   */
  async resizeImage(image: Buffer, width: number, height: number, quality: number): Promise<Buffer> {
    return await sharp(image)
      .resize(width, height, {
        fit: 'inside', // アスペクト比を維持しながらリサイズ
        withoutEnlargement: true, // 拡大しない
      })
      .jpeg({ quality })
      .toBuffer();
  }

  /**
   * サムネイルを生成する
   * 
   * @param image 元画像のBuffer
   * @returns サムネイル画像のBuffer
   */
  async generateThumbnail(image: Buffer): Promise<Buffer> {
    return await sharp(image)
      .resize(cameraConfig.thumbnail.width, cameraConfig.thumbnail.height, {
        fit: 'cover', // アスペクト比を維持しながら、指定サイズに収まるようにリサイズ
        position: 'center', // 中央を基準にクロップ
      })
      .jpeg({ quality: cameraConfig.thumbnail.quality })
      .toBuffer();
  }

  /**
   * カメラを解放する
   */
  async release(): Promise<void> {
    if (this.initialized) {
      await this.driver.release();
      this.initialized = false;
    }
  }

  /**
   * カメラが利用可能かどうかを確認する
   */
  async isAvailable(): Promise<boolean> {
    return await this.driver.isAvailable();
  }
}

