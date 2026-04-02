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

  findNearestNeighbors(params: {
    queryEmbedding: number[];
    excludeLoanId: string;
    limit: number;
  }): Promise<SimilarityGalleryNeighbor[]>;

  /** BTRIM("canonicalLabel") との一致。label は呼び出し側で trim 済みを渡すこと。空は 0 件 */
  countRowsByCanonicalLabel(trimmedCanonicalLabel: string): Promise<number>;
};
