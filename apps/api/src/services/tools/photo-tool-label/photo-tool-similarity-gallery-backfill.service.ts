import type { PhotoToolHumanLabelQuality } from '@prisma/client';

import { prisma } from '../../../lib/prisma.js';

import type { GalleryIndexLoanSnapshot, PhotoToolGalleryIndexService } from './photo-tool-gallery-index.service.js';

export type PhotoToolGalleryBackfillStats = {
  batches: number;
  loansSeen: number;
  succeeded: number;
  failed: number;
};

type GoodPhotoLoanRow = {
  id: string;
  photoUrl: string | null;
  photoToolHumanQuality: PhotoToolHumanLabelQuality | null;
  photoToolHumanDisplayName: string | null;
  photoToolDisplayName: string | null;
  itemId: string | null;
  photoTakenAt: Date | null;
};

/**
 * 既存の GOOD 写真持出をギャラリーへ再投入する（埋め込み有効時のみ意味がある）。
 * レビュー PATCH 後の非同期 index と同じ `syncFromSnapshot` を再利用する。
 */
export class PhotoToolSimilarityGalleryBackfillService {
  constructor(private readonly galleryIndex: PhotoToolGalleryIndexService) {}

  private rowToSnapshot(row: GoodPhotoLoanRow): GalleryIndexLoanSnapshot {
    return {
      id: row.id,
      photoUrl: row.photoUrl,
      photoToolHumanQuality: row.photoToolHumanQuality,
      photoToolHumanDisplayName: row.photoToolHumanDisplayName,
      photoToolDisplayName: row.photoToolDisplayName,
      itemId: row.itemId,
      photoTakenAt: row.photoTakenAt,
    };
  }

  /**
   * `id` 昇順でページングし、全 GOOD 写真持出を処理する。
   */
  async runAll(options: { batchSize: number }): Promise<PhotoToolGalleryBackfillStats> {
    const batchSize = Math.min(Math.max(options.batchSize, 1), 500);
    const stats: PhotoToolGalleryBackfillStats = {
      batches: 0,
      loansSeen: 0,
      succeeded: 0,
      failed: 0,
    };

    let lastId: string | undefined;
    for (;;) {
      const baseWhere = {
        photoUrl: { not: null },
        itemId: null,
        photoTakenAt: { not: null },
        photoToolHumanQuality: 'GOOD' as const,
      };
      const rows: GoodPhotoLoanRow[] = await prisma.loan.findMany({
        where: lastId ? { ...baseWhere, id: { gt: lastId } } : baseWhere,
        orderBy: { id: 'asc' },
        take: batchSize,
        select: {
          id: true,
          photoUrl: true,
          photoToolHumanQuality: true,
          photoToolHumanDisplayName: true,
          photoToolDisplayName: true,
          itemId: true,
          photoTakenAt: true,
        },
      });

      if (rows.length === 0) {
        break;
      }

      stats.batches += 1;

      for (const row of rows) {
        stats.loansSeen += 1;
        try {
          await this.galleryIndex.syncFromSnapshot(this.rowToSnapshot(row));
          stats.succeeded += 1;
        } catch {
          stats.failed += 1;
        }
        lastId = row.id;
      }
    }

    return stats;
  }
}
