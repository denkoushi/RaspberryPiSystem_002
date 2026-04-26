/**
 * 埋め込みバックエンド変更・backfill 要否の判断用に、秘密を含まない識別子を組み立てる。
 * DB 行の embeddingModelId / imagePipelineVersion と併せて運用ログに出す。
 */
export function formatPhotoToolEmbeddingFingerprint(input: {
  embeddingUrl: string;
  modelId: string;
  pipelineVersion: string;
  dimension: number;
}): string {
  let host = 'unknown-host';
  try {
    host = new URL(input.embeddingUrl).host;
  } catch {
    /* keep unknown-host */
  }
  return `urlHost=${host} modelId=${input.modelId} dim=${input.dimension} pipeline=${input.pipelineVersion}`;
}
