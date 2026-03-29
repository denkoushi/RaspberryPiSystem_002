/**
 * 写真 JPEG バイト列から埋め込みベクトルを取得する境界。
 * 実装は HTTP マイクロサービス等に差し替え可能。
 */
export type PhotoToolImageEmbeddingPort = {
  /**
   * @returns 次元は env の PHOTO_TOOL_EMBEDDING_DIMENSION と一致すること
   */
  embedJpeg(jpegBytes: Buffer): Promise<number[]>;
};
