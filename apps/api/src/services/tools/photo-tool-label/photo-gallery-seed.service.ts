import { randomUUID } from 'node:crypto';

import { ApiError } from '../../../lib/errors.js';
import { logger } from '../../../lib/logger.js';
import { PhotoStorage } from '../../../lib/photo-storage.js';
import { preparePhotoAndThumbnailForStorage } from '../../../lib/photo-loan-storage-image.js';
import { prisma } from '../../../lib/prisma.js';

import type { PhotoToolGalleryIndexService } from './photo-tool-gallery-index.service.js';
import { normalizePhotoToolDisplayName } from './photo-tool-label-normalize.js';

const log = logger.child({ component: 'photoGallerySeed' });

export type PhotoGallerySeedServiceDeps = {
  galleryIndex: PhotoToolGalleryIndexService;
};

function isJpegMagic(buf: Buffer): boolean {
  return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

/**
 * 類似ギャラリー用: 管理画面から JPEG + 教師ラベルで Loan を1件作成し、ギャラリー index を通知する。
 * 実貸出ではないため returnedAt を同時刻で立て、キオスク active から除外する。
 */
export class PhotoGallerySeedService {
  constructor(private readonly deps: PhotoGallerySeedServiceDeps) {}

  async createFromUpload(input: {
    jpegBuffer: Buffer;
    canonicalLabelRaw: string;
    reviewerUserId: string;
  }): Promise<{ loanId: string; photoUrl: string; canonicalLabel: string }> {
    if (!isJpegMagic(input.jpegBuffer)) {
      throw new ApiError(400, 'JPEG 画像をアップロードしてください');
    }

    const canonicalLabel = normalizePhotoToolDisplayName(input.canonicalLabelRaw);
    if (!canonicalLabel) {
      throw new ApiError(400, '教師ラベル（表示名）が空です');
    }

    let photoPathInfo;
    try {
      const { originalJpeg, thumbnailJpeg } = await preparePhotoAndThumbnailForStorage(input.jpegBuffer);
      const storageKey = `galseed_${randomUUID()}`;
      photoPathInfo = await PhotoStorage.savePhoto(storageKey, originalJpeg, thumbnailJpeg);
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      log.error({ err: e }, 'Photo gallery seed image processing failed');
      throw new ApiError(500, `画像の処理に失敗しました: ${e.message}`);
    }

    const now = new Date();
    let loan: Awaited<ReturnType<typeof prisma.loan.create>>;
    try {
      loan = await prisma.loan.create({
        data: {
          itemId: null,
          employeeId: null,
          clientId: null,
          photoUrl: photoPathInfo.relativePath,
          photoTakenAt: now,
          photoToolLabelRequested: false,
          photoToolHumanDisplayName: canonicalLabel,
          photoToolHumanQuality: 'GOOD',
          photoToolHumanReviewedAt: now,
          photoToolHumanReviewedByUserId: input.reviewerUserId,
          photoToolGallerySeed: true,
          returnedAt: now,
        },
      });
    } catch (err) {
      // DB 保存に失敗したときは画像孤児化を防ぐ
      await PhotoStorage.deletePhoto(photoPathInfo.relativePath).catch(() => undefined);
      throw err;
    }

    this.deps.galleryIndex.notifyAfterReview({
      id: loan.id,
      photoUrl: loan.photoUrl,
      photoToolHumanQuality: loan.photoToolHumanQuality,
      photoToolHumanDisplayName: loan.photoToolHumanDisplayName,
      photoToolDisplayName: loan.photoToolDisplayName,
      itemId: loan.itemId,
      photoTakenAt: loan.photoTakenAt,
    });

    log.info({ loanId: loan.id, canonicalLabel }, 'Photo gallery seed loan created');

    return {
      loanId: loan.id,
      photoUrl: photoPathInfo.relativePath,
      canonicalLabel,
    };
  }
}
