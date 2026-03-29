import { env } from '../../../config/env.js';
import { ApiError } from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';

import type { PhotoToolImageEmbeddingPort } from './photo-tool-image-embedding.port.js';
import type { PhotoToolVisionImageSourcePort } from './photo-tool-label-ports.js';
import type { PhotoToolSimilarityGalleryRepositoryPort } from './photo-tool-similarity-gallery-repository.port.js';

export type PhotoSimilarCandidateDto = {
  sourceLoanId: string;
  canonicalLabel: string;
  /** pgvector cosine distance (<=>); 小さいほど類似 */
  cosineDistance: number;
  /** 説明用: 1 - cosineDistance（同一方向で 1 に近い） */
  score: number;
};

export class PhotoToolSimilarCandidateService {
  constructor(
    private readonly embedding: PhotoToolImageEmbeddingPort | null,
    private readonly gallery: PhotoToolSimilarityGalleryRepositoryPort,
    private readonly vision: PhotoToolVisionImageSourcePort
  ) {}

  async getCandidates(loanId: string): Promise<{ candidates: PhotoSimilarCandidateDto[] }> {
    if (!env.PHOTO_TOOL_EMBEDDING_ENABLED || !this.embedding) {
      return { candidates: [] };
    }

    const loan = await prisma.loan.findFirst({ where: { id: loanId } });
    if (!loan) {
      throw new ApiError(404, '貸出が見つかりません');
    }
    if (!loan.photoUrl || loan.itemId != null || !loan.photoTakenAt) {
      throw new ApiError(400, '写真持出の貸出ではありません');
    }

    const jpeg = await this.vision.readImageBytesForVision(loan.photoUrl);
    const queryEmbedding = await this.embedding.embedJpeg(jpeg);

    const maxCandidates = env.PHOTO_TOOL_SIMILARITY_MAX_CANDIDATES;
    const maxDist = env.PHOTO_TOOL_SIMILARITY_MAX_COSINE_DISTANCE;
    const fetchLimit = Math.min(100, maxCandidates * 10);

    const neighbors = await this.gallery.findNearestNeighbors({
      queryEmbedding,
      excludeLoanId: loanId,
      limit: fetchLimit,
    });

    const filtered = neighbors
      .filter((n) => n.distance <= maxDist)
      .slice(0, maxCandidates)
      .map((n) => ({
        sourceLoanId: n.sourceLoanId,
        canonicalLabel: n.canonicalLabel,
        cosineDistance: n.distance,
        score: 1 - n.distance,
      }));

    return { candidates: filtered };
  }
}
