/**
 * 写真持出で人レビュー GOOD 済みの既存 Loan を photo_tool_similarity_gallery へ再投入する。
 *
 * 前提:
 * - PHOTO_TOOL_EMBEDDING_ENABLED=true かつ PHOTO_TOOL_EMBEDDING_URL / MODEL_ID が有効
 * - 通常は Pi5 API コンテナ内で実行（compose が env を注入）
 *
 * 使い方:
 *   pnpm --filter @raspi-system/api backfill:photo-tool-gallery
 *   PHOTO_TOOL_GALLERY_BACKFILL_BATCH_SIZE=50 pnpm --filter @raspi-system/api backfill:photo-tool-gallery
 *
 * Docker:
 *   docker compose -f infrastructure/docker/docker-compose.server.yml exec -T api pnpm backfill:photo-tool-gallery:prod
 */

import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { createHttpPhotoToolImageEmbeddingAdapter } from '../services/tools/photo-tool-label/http-photo-tool-image-embedding.adapter.js';
import { PgPhotoToolSimilarityGalleryRepository } from '../services/tools/photo-tool-label/pg-photo-tool-similarity-gallery.repository.js';
import { PhotoStorageVisionImageSource } from '../services/tools/photo-tool-label/photo-storage-vision-image-source.adapter.js';
import { PhotoToolGalleryIndexService } from '../services/tools/photo-tool-label/photo-tool-gallery-index.service.js';
import { PhotoToolSimilarityGalleryBackfillService } from '../services/tools/photo-tool-label/photo-tool-similarity-gallery-backfill.service.js';

function parseBatchSize(): number {
  const raw = process.env.PHOTO_TOOL_GALLERY_BACKFILL_BATCH_SIZE?.trim();
  const n = raw ? Number.parseInt(raw, 10) : 25;
  if (!Number.isFinite(n) || n < 1) {
    return 25;
  }
  return Math.min(n, 500);
}

async function main(): Promise<number> {
  if (!env.PHOTO_TOOL_EMBEDDING_ENABLED) {
    console.error('[backfill-photo-tool-gallery] PHOTO_TOOL_EMBEDDING_ENABLED が true ではありません。中止します。');
    return 1;
  }

  const embedding = createHttpPhotoToolImageEmbeddingAdapter();
  if (!embedding) {
    console.error(
      '[backfill-photo-tool-gallery] 埋め込み adapter を初期化できません（PHOTO_TOOL_EMBEDDING_URL 等を確認）。中止します。'
    );
    return 1;
  }

  const batchSize = parseBatchSize();
  console.log(`[backfill-photo-tool-gallery] batchSize=${batchSize}`);

  const vision = new PhotoStorageVisionImageSource();
  const galleryRepo = new PgPhotoToolSimilarityGalleryRepository(env.PHOTO_TOOL_EMBEDDING_DIMENSION);
  const galleryIndex = new PhotoToolGalleryIndexService(embedding, galleryRepo, vision);
  const backfill = new PhotoToolSimilarityGalleryBackfillService(galleryIndex);

  const stats = await backfill.runAll({ batchSize });
  console.log('[backfill-photo-tool-gallery] Done:', stats);

  if (stats.failed > 0) {
    return 2;
  }
  return 0;
}

void main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    console.error('[backfill-photo-tool-gallery] Error:', err);
    process.exitCode = 1;
  })
  .finally(() =>
    prisma.$disconnect().catch(() => {
      /* ignore */
    })
  );
