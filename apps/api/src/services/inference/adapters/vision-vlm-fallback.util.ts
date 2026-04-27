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
  return false;
}

export function classifyVlmHttp400SubReason(status: number, bodyText: string): VlmImageHttp400SubReason {
  if (status !== 400) {
    return 'unknown';
  }
  const b = bodyText.toLowerCase();
  if (b.includes('too large') || b.includes('max pixels') || b.includes('exceed')) {
    return 'size';
  }
  if (isLikelyVlmImageLoadOrDecodeHttp400(status, bodyText)) {
    return 'image_decode';
  }
  return 'unknown';
}

/**
 * 1 回目の VLM 入力で 400（デコード系）になったとき、より保守的な JPEG に落として再送する。
 * - 最大辺を 512 に収める（withoutEnlargement）
 * - 品質を下げて再エンコード（mozjpeg）
 */
export async function reencodeImageBufferForVlmFallback(imageBytes: Buffer, sourceMimeType: string): Promise<Buffer> {
  void sourceMimeType; // 将来: MIME 別パイプ（例: PNG のみ色空間固定）用に引数は維持
  // JPEG/PNG/WebP 等は sharp が判別。最大辺 512 以内・同品質の JPEG へ正規化して vLLM 側のデコード揺れを減らす。
  return sharp(imageBytes, { failOn: 'none' })
    .rotate()
    .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 72, mozjpeg: true })
    .toBuffer();
}
