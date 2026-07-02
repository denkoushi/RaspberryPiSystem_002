import type { ImageOcrInput } from './image-ocr.port.js';

export type ImageOcrLayoutWord = {
  text: string;
  confidence: number | null;
  bbox: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  };
};

export type ImageOcrLayoutResult = {
  text: string;
  engine: string;
  words: ImageOcrLayoutWord[];
};

/**
 * 画像OCRの座標付き境界。テキストのみの ImageOcrPort とは分け、
 * 図面寸法候補など bbox が必要な用途だけが依存する。
 */
export interface ImageOcrLayoutPort {
  runLayoutOcrOnImage(input: ImageOcrInput): Promise<ImageOcrLayoutResult>;
}
