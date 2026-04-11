/**
 * OpenAI 互換 vision chat completions への境界（ドメイン非依存）。
 * 写真持出ラベル以外の画像→テキスト用途でも再利用する。
 */

export type VisionCompletionInput = {
  userText: string;
  /** JPEG 等の raw bytes（base64 はアダプタ内で付与） */
  imageBytes: Buffer;
  mimeType: 'image/jpeg';
};

export type VisionCompletionResult = {
  /** モデルが返したプレーンテキスト（正規化前） */
  rawText: string;
};

export interface VisionCompletionPort {
  complete(input: VisionCompletionInput): Promise<VisionCompletionResult>;
}
