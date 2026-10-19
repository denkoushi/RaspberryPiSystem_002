export type SimilarityGalleryNeighbor = {
  sourceLoanId: string;
  canonicalLabel: string;
  /** pgvector cosine distance (<=>); smaller is more similar */
  distance: number;
};

export type PhotoToolSimilarityGalleryRepositoryPort = {
  upsert(entry: {
    loanId: string;
    embedding: number[];
    canonicalLabel: string;
    embeddingModelId: string;
    imagePipelineVersion: string | null;
  }): Promise<void>;

  deleteByLoanId(loanId: string): Promise<void>;

  /** リポジトリに設定された現在の embeddingModelId の行だけを検索する。未設定なら空配列 */
  findNearestNeighbors(params: {
    queryEmbedding: number[];
    excludeLoanId: string;
    limit: number;
  }): Promise<SimilarityGalleryNeighbor[]>;

  /** 現在の embeddingModelId の行のみ。BTRIM("canonicalLabel") と一致。label は trim 済み。空／モデル未設定は 0 件 */
  countRowsByCanonicalLabel(trimmedCanonicalLabel: string): Promise<number>;
};
