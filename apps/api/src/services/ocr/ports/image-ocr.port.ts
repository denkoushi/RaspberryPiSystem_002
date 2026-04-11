/**
 * スマホ撮影などのラスタ画像に対する OCR 境界（PDF 向け OcrEnginePort とは分離）。
 */

export type ImageOcrMimeType = 'image/jpeg' | 'image/png' | 'image/webp';

export type ImageOcrInput = {
  imageBytes: Buffer;
  mimeType: ImageOcrMimeType;
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
