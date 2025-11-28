/**
 * カメラドライバーのインターフェース
 * 
 * 異なるカメラタイプ（Raspberry Pi Camera Module、USBカメラなど）に対応するため、
 * このインターフェースを実装したドライバーを作成する。
 */
export interface CameraDriver {
  /**
   * カメラを初期化する
   * @throws {Error} カメラの初期化に失敗した場合
   */
  initialize(): Promise<void>;

  /**
   * 写真を撮影する
   * @returns 撮影した画像のBuffer
   * @throws {Error} 撮影に失敗した場合
   */
  capture(): Promise<Buffer>;

  /**
   * カメラを解放する
   */
  release(): Promise<void>;

  /**
   * カメラが利用可能かどうかを確認する
   * @returns カメラが利用可能な場合true
   */
  isAvailable(): Promise<boolean>;
}

