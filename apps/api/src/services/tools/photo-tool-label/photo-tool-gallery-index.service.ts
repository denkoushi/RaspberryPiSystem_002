import type { PhotoToolHumanLabelQuality } from '@prisma/client';

import { env } from '../../../config/env.js';
import { logger } from '../../../lib/logger.js';

import type { PhotoToolImageEmbeddingPort } from './photo-tool-image-embedding.port.js';
import type { PhotoToolVisionImageSourcePort } from './photo-tool-label-ports.js';
import type { PhotoToolSimilarityGalleryRepositoryPort } from './photo-tool-similarity-gallery-repository.port.js';

const DEFAULT_CANONICAL_LABEL = '撮影mode';

export type GalleryIndexLoanSnapshot = {
  id: string;
  photoUrl: string | null;
  photoToolHumanQuality: PhotoToolHumanLabelQuality | null;
  photoToolHumanDisplayName: string | null;
  photoToolDisplayName: string | null;
  itemId: string | null;
  photoTakenAt: Date | null;
};

/**
 * 人レビュー確定後に GOOD ギャラリーを更新する（非同期・失敗はログ）。
 */
export class PhotoToolGalleryIndexService {
  constructor(
    private readonly embedding: PhotoToolImageEmbeddingPort | null,
    private readonly gallery: PhotoToolSimilarityGalleryRepositoryPort,
    private readonly vision: PhotoToolVisionImageSourcePort
  ) {}

  notifyAfterReview(saved: GalleryIndexLoanSnapshot): void {
    if (!env.PHOTO_TOOL_EMBEDDING_ENABLED) {
      return;
    }
    if (!this.embedding) {
      logger.warn({ loanId: saved.id }, 'Photo gallery index skipped: embedding adapter missing');
      return;
    }
    queueMicrotask(() => {
      void this.sync(saved).catch((err: unknown) => {
        logger.error(
          { err, loanId: saved.id },
          'Photo tool similarity gallery index failed (async)'
        );
      });
    });
  }

  private isPhotoLoan(row: GalleryIndexLoanSnapshot): boolean {
    return Boolean(row.photoUrl && row.itemId == null && row.photoTakenAt);
  }

  private async sync(saved: GalleryIndexLoanSnapshot): Promise<void> {
    if (!this.isPhotoLoan(saved)) {
      return;
    }
    const loanId = saved.id;
    if (saved.photoToolHumanQuality !== 'GOOD') {
      await this.gallery.deleteByLoanId(loanId);
      return;
    }
    const photoUrl = saved.photoUrl!;
    const human = saved.photoToolHumanDisplayName?.trim();
    const vlm = saved.photoToolDisplayName?.trim();
    const canonicalLabel = (human && human.length > 0 ? human : vlm) ?? DEFAULT_CANONICAL_LABEL;
    const jpeg = await this.vision.readImageBytesForVision(photoUrl);
    const embedding = await this.embedding!.embedJpeg(jpeg);
    await this.gallery.upsert({
      loanId,
      embedding,
      canonicalLabel,
      embeddingModelId: env.PHOTO_TOOL_EMBEDDING_MODEL_ID!,
      imagePipelineVersion: env.PHOTO_TOOL_SIMILARITY_PIPELINE_VERSION,
    });
  }
}
