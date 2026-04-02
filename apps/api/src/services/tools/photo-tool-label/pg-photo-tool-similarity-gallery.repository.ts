import { prisma } from '../../../lib/prisma.js';

import type {
  PhotoToolSimilarityGalleryRepositoryPort,
  SimilarityGalleryNeighbor,
} from './photo-tool-similarity-gallery-repository.port.js';

/**
 * pgvector テーブルへのアクセスは Prisma スキーマ外のため $queryRawUnsafe に閉じる。
 * embedding は長さ検証済みの number[] のみを渡すこと。
 */
export class PgPhotoToolSimilarityGalleryRepository implements PhotoToolSimilarityGalleryRepositoryPort {
  constructor(private readonly embeddingDimension: number) {}

  private formatVectorLiteral(embedding: number[]): string {
    if (embedding.length !== this.embeddingDimension) {
      throw new Error(`Embedding dimension mismatch: expected ${this.embeddingDimension}, got ${embedding.length}`);
    }
    if (!embedding.every((value) => Number.isFinite(value))) {
      throw new Error('Embedding contains non-finite numbers');
    }
    return `[${embedding.map((x) => Number(x).toFixed(8)).join(',')}]`;
  }

  async upsert(entry: {
    loanId: string;
    embedding: number[];
    canonicalLabel: string;
    embeddingModelId: string;
    imagePipelineVersion: string | null;
  }): Promise<void> {
    const vec = this.formatVectorLiteral(entry.embedding);
    await prisma.$executeRawUnsafe(
      `INSERT INTO "photo_tool_similarity_gallery"
        ("loanId", "embedding", "canonicalLabel", "embeddingModelId", "imagePipelineVersion", "indexedAt")
       VALUES ($1, $2::vector, $3, $4, $5, NOW())
       ON CONFLICT ("loanId") DO UPDATE SET
         "embedding" = EXCLUDED."embedding",
         "canonicalLabel" = EXCLUDED."canonicalLabel",
         "embeddingModelId" = EXCLUDED."embeddingModelId",
         "imagePipelineVersion" = EXCLUDED."imagePipelineVersion",
         "indexedAt" = NOW()`,
      entry.loanId,
      vec,
      entry.canonicalLabel,
      entry.embeddingModelId,
      entry.imagePipelineVersion
    );
  }

  async deleteByLoanId(loanId: string): Promise<void> {
    await prisma.$executeRawUnsafe(`DELETE FROM "photo_tool_similarity_gallery" WHERE "loanId" = $1`, loanId);
  }

  async findNearestNeighbors(params: {
    queryEmbedding: number[];
    excludeLoanId: string;
    limit: number;
  }): Promise<SimilarityGalleryNeighbor[]> {
    const safeLimit = Math.max(1, Math.min(Math.trunc(params.limit), 100));
    const vec = this.formatVectorLiteral(params.queryEmbedding);
    const rows = await prisma.$queryRawUnsafe<
      { loanId: string; canonicalLabel: string; distance: number }[]
    >(
      `SELECT g."loanId" AS "loanId", g."canonicalLabel" AS "canonicalLabel",
              (g."embedding" <=> $1::vector) AS distance
       FROM "photo_tool_similarity_gallery" g
       WHERE g."loanId" <> $2
       ORDER BY g."embedding" <=> $1::vector
       LIMIT $3`,
      vec,
      params.excludeLoanId,
      safeLimit
    );
    return rows.map((r) => ({
      sourceLoanId: r.loanId,
      canonicalLabel: r.canonicalLabel,
      distance: Number(r.distance),
    }));
  }

  async countRowsByCanonicalLabel(trimmedCanonicalLabel: string): Promise<number> {
    if (!trimmedCanonicalLabel) {
      return 0;
    }
    const rows = await prisma.$queryRawUnsafe<{ count: bigint | number | string }[]>(
      `SELECT COUNT(*)::bigint AS count
       FROM "photo_tool_similarity_gallery" g
       WHERE BTRIM(g."canonicalLabel") = $1`,
      trimmedCanonicalLabel
    );
    const n = rows[0]?.count;
    const parsed = typeof n === 'bigint' ? Number(n) : Number(n ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
  }
}
