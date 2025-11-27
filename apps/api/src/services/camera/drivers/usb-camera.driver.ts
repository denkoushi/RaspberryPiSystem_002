import { exec } from 'child_process';
import { promisify } from 'util';
import { readFile } from 'fs/promises';
import type { CameraDriver } from './camera-driver.interface.js';

const execAsync = promisify(exec);

/**
 * USBカメラドライバー
 * 
 * fswebcamを使用してUSBカメラから写真を撮影する。
 * デフォルトで/dev/video0を使用する。
 */
export class USBCameraDriver implements CameraDriver {
  private initialized = false;
  private devicePath: string;

  constructor(devicePath: string = '/dev/video0') {
    this.devicePath = devicePath;
  }

  async initialize(): Promise<void> {
    // fswebcamがインストールされているか確認
    try {
      await execAsync('which fswebcam');
    } catch (error) {
      throw new Error(
        'fswebcam is not installed. Please install it with: sudo apt install -y fswebcam'
      );
    }

    // カメラデバイスが存在するか確認
    try {
      await execAsync(`test -c ${this.devicePath}`);
    } catch (error) {
      throw new Error(`Camera device not found: ${this.devicePath}`);
    }

    this.initialized = true;
  }

  async capture(): Promise<Buffer> {
    if (!this.initialized) {
      throw new Error('Camera not initialized. Call initialize() first.');
    }

    // 一時ファイルに保存
    const tempFile = `/tmp/capture_${Date.now()}.jpg`;

    try {
      // fswebcamで撮影（800x600px、JPEG品質80%、ノイズ低減、フレームスキップ）
      // --no-banner: バナーを表示しない
      // --resolution: 解像度を指定
      // --jpeg: JPEG品質を指定
      // --skip: フレームをスキップして安定した画像を取得
      const command = `fswebcam --no-banner --device ${this.devicePath} --resolution 800x600 --jpeg 80 --skip 5 ${tempFile}`;
      
      await execAsync(command, { timeout: 10000 }); // 10秒のタイムアウト

      // ファイルを読み込む
      const imageBuffer = await readFile(tempFile);

      // 一時ファイルを削除
      await execAsync(`rm -f ${tempFile}`).catch(() => {
        // 削除に失敗しても無視（エラーハンドリングのため）
      });

      return imageBuffer;
    } catch (error) {
      // エラー時も一時ファイルを削除
      await execAsync(`rm -f ${tempFile}`).catch(() => {
        // 削除に失敗しても無視
      });

      if (error instanceof Error) {
        throw new Error(`Failed to capture image: ${error.message}`);
      }
      throw error;
    }
  }

  async release(): Promise<void> {
    this.initialized = false;
  }

  async isAvailable(): Promise<boolean> {
    try {
      // fswebcamがインストールされているか確認
      await execAsync('which fswebcam');
      
      // カメラデバイスが存在するか確認
      await execAsync(`test -c ${this.devicePath}`);
      
      return true;
    } catch {
      return false;
    }
  }
}

