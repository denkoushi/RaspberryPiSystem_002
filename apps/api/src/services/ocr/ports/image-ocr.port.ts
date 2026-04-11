/**
 * スマホ撮影などのラスタ画像に対する OCR 境界（PDF 向け OcrEnginePort とは分離）。
 */

import type { ImageOcrProfile } from '../image-ocr-profiles.js';

export type ImageOcrMimeType = 'image/jpeg' | 'image/png' | 'image/webp';

export type ImageOcrInput = {
  imageBytes: Buffer;
  mimeType: ImageOcrMimeType;
  /**
   * 用途別 OCR。省略時は後方互換の既定（単一パス jpn+eng・従来と同様）。
   * 現品票フローでは mobile-placement service が複数プロファイルを順に実行する。
   */
  profile?: ImageOcrProfile;
};

export type ImageOcrResult = {
  /** OCR エンジンが返したプレーンテキスト（正規化前） */
  text: string;
  engine: string;
};

/**
 * 画像バイト列からテキストを抽出する（ドメイン非依存）。
 */
export interface ImageOcrPort {
  runOcrOnImage(input: ImageOcrInput): Promise<ImageOcrResult>;
}
