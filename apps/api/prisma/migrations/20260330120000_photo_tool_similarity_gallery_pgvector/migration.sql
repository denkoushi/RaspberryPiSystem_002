-- pgvector: similarity search for photo-tool label gallery (human GOOD only at index time)
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateTable
CREATE TABLE "photo_tool_similarity_gallery" (
    "loanId" TEXT NOT NULL,
    "embedding" vector(512) NOT NULL,
    "canonicalLabel" TEXT NOT NULL,
    "embeddingModelId" TEXT NOT NULL,
    "imagePipelineVersion" TEXT,
    "indexedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "photo_tool_similarity_gallery_pkey" PRIMARY KEY ("loanId")
);

-- AddForeignKey
ALTER TABLE "photo_tool_similarity_gallery" ADD CONSTRAINT "photo_tool_similarity_gallery_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Approximate nearest neighbor search (cosine distance)
CREATE INDEX "photo_tool_similarity_gallery_embedding_hnsw" ON "photo_tool_similarity_gallery" USING hnsw ("embedding" vector_cosine_ops);
