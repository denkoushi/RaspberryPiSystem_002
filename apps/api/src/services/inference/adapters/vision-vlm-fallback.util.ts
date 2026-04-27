/**
 * VLM（OpenAI 互換 /v1/chat/completions）向け: 画像系 400 の判定と、再送用の JPEG 再エンコード。
 * DGX blue（vLLM）で「画像デコードに失敗」系の 400 が出た場合の切り分け・1 回限りのフォールバックに使う。
 */

import sharp from 'sharp';

export type VlmImageHttp400SubReason = 'image_decode' | 'size' | 'unknown';

/**
 * 画像ロード/デコード失敗っぽい vLLM 400 か（本文に依存。英日混在を想定しない簡易判定）。
 */
export function isLikelyVlmImageLoadOrDecodeHttp400(status: number, bodyText: string): boolean {
  if (status !== 400) {
    return false;
  }
  const b = bodyText.toLowerCase();
  if (b.includes('failed to load image') || b.includes('cannot identify image file')) {
    return true;
  }
  if (b.includes('invalid image') && (b.includes('decode') || b.includes('load'))) {
    return true;
  }
  if (b.includes('image') && (b.includes('decode') || b.includes('corrupt'))) {
    return true;
  }
  // vLLM / OpenAI 互換の短い本文・JSON 内 message
  if (b.includes('could not') && b.includes('image')) {
    return true;
  }
  if (b.includes('unable to') && b.includes('decode') && b.includes('image')) {
    return true;
  }
  if (b.includes('error processing') && b.includes('image')) {
    return true;
  }
  if (b.includes('invalid_base64') || b.includes('invalid base64')) {
    return true;
  }
  return false;
}

/**
 * 400 時に **1 回だけ** JPEG 再送を試みるべきか。
 * - デコード系に加え、ピクセル/解像度超過（`classifyVlmHttp400SubReason` が `size`）も再エンコードで縮小可能。
 */
export function isRetryableVlmImageHttp400(status: number, bodyText: string): boolean {
  if (status !== 400) {
    return false;
  }
  if (isLikelyVlmImageLoadOrDecodeHttp400(status, bodyText)) {
    return true;
  }
  if (classifyVlmHttp400SubReason(status, bodyText) === 'size') {
    return true;
  }
  const b = bodyText.toLowerCase();
  if (b.includes('image') && (b.includes('pretoken') || b.includes('tokenization') || b.includes('vision'))) {
    return true;
  }
  return false;
}

export function classifyVlmHttp400SubReason(status: number, bodyText: string): VlmImageHttp400SubReason {
  if (status !== 400) {
    return 'unknown';
  }
  const b = bodyText.toLowerCase();
  if (
    b.includes('too large') ||
    b.includes('max pixels') ||
    b.includes('max resolution') ||
    (b.includes('exceed') && (b.includes('pixel') || b.includes('image') || b.includes('size'))) ||
    (b.includes('pixel') && (b.includes('limit') || b.includes('exceed'))) ||
    (b.includes('dimension') && b.includes('exceed'))
  ) {
    return 'size';
  }
  if (isLikelyVlmImageLoadOrDecodeHttp400(status, bodyText)) {
    return 'image_decode';
  }
  return 'unknown';
}

export type VlmReencodeOptions = {
  /** 長辺の上限（px）。`size` 系 400 ではより小さく寄せる */
  maxEdge?: number;
  quality?: number;
};

/**
 * 1 回目の VLM 入力で 400 になったとき、より保守的な JPEG に落として再送する。
 * 既定: 最大辺 512、品質 72。`size` 想定時は呼び出し側で `maxEdge` / `quality` を下げる。
 */
export async function reencodeImageBufferForVlmFallback(
  imageBytes: Buffer,
  sourceMimeType: string,
  options?: VlmReencodeOptions
): Promise<Buffer> {
  void sourceMimeType; // 将来: MIME 別パイプ（例: PNG のみ色空間固定）用に引数は維持
  const maxEdge = options?.maxEdge ?? 512;
  const quality = options?.quality ?? 72;
  return sharp(imageBytes, { failOn: 'none' })
    .rotate()
    .resize(maxEdge, maxEdge, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();
}
