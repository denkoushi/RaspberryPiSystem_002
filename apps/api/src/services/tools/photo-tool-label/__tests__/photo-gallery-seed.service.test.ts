import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../../../lib/errors.js';
import { PhotoGallerySeedService } from '../photo-gallery-seed.service.js';

vi.mock('../../../../lib/prisma.js', () => ({
  prisma: {
    loan: {
      create: vi.fn(),
    },
  },
}));

vi.mock('../../../../lib/photo-storage.js', () => ({
  PhotoStorage: {
    savePhoto: vi.fn(),
    deletePhoto: vi.fn(),
  },
}));

vi.mock('../../../../lib/photo-loan-storage-image.js', () => ({
  preparePhotoAndThumbnailForStorage: vi.fn(),
}));

import { prisma } from '../../../../lib/prisma.js';
import { PhotoStorage } from '../../../../lib/photo-storage.js';
import { preparePhotoAndThumbnailForStorage } from '../../../../lib/photo-loan-storage-image.js';

describe('PhotoGallerySeedService', () => {
  const jpegHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(preparePhotoAndThumbnailForStorage).mockResolvedValue({
      originalJpeg: Buffer.from('orig'),
      thumbnailJpeg: Buffer.from('thumb'),
    });
    vi.mocked(PhotoStorage.savePhoto).mockResolvedValue({
      year: '2026',
      month: '04',
      filename: 'f.jpg',
      thumbnailFilename: 'f_thumb.jpg',
      fullPath: '/tmp/f.jpg',
      thumbnailPath: '/tmp/f_thumb.jpg',
      relativePath: '/api/storage/photos/2026/04/f.jpg',
      thumbnailRelativePath: '/storage/thumbnails/2026/04/f_thumb.jpg',
    });
    vi.mocked(PhotoStorage.deletePhoto).mockResolvedValue(undefined);
  });

  it('rejects non-JPEG magic', async () => {
    const galleryIndex = { notifyAfterReview: vi.fn() };
    const svc = new PhotoGallerySeedService({ galleryIndex: galleryIndex as never });
    await expect(
      svc.createFromUpload({
        jpegBuffer: Buffer.from([0x01, 0x02]),
        canonicalLabelRaw: 'a',
        reviewerUserId: 'u1',
      })
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.loan.create).not.toHaveBeenCalled();
  });

  it('rejects empty label', async () => {
    const galleryIndex = { notifyAfterReview: vi.fn() };
    const svc = new PhotoGallerySeedService({ galleryIndex: galleryIndex as never });
    await expect(
      svc.createFromUpload({
        jpegBuffer: jpegHeader,
        canonicalLabelRaw: '   ',
        reviewerUserId: 'u1',
      })
    ).rejects.toBeInstanceOf(ApiError);
  });

  it('creates seed loan and notifies gallery index', async () => {
    const now = new Date('2026-04-01T12:00:00Z');
    vi.useFakeTimers({ now });

    vi.mocked(prisma.loan.create).mockResolvedValue({
      id: 'loan-seed-1',
      photoUrl: '/api/storage/photos/2026/04/f.jpg',
      photoToolHumanQuality: 'GOOD',
      photoToolHumanDisplayName: 'ペンチ',
      photoToolDisplayName: null,
      itemId: null,
      photoTakenAt: now,
    } as never);

    const galleryIndex = { notifyAfterReview: vi.fn() };
    const svc = new PhotoGallerySeedService({ galleryIndex: galleryIndex as never });

    const result = await svc.createFromUpload({
      jpegBuffer: jpegHeader,
      canonicalLabelRaw: ' ペンチ ',
      reviewerUserId: 'admin-1',
    });

    expect(result.loanId).toBe('loan-seed-1');
    expect(result.canonicalLabel).toBe('ペンチ');
    expect(PhotoStorage.savePhoto).toHaveBeenCalled();
    expect(prisma.loan.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        itemId: null,
        employeeId: null,
        clientId: null,
        photoUrl: '/api/storage/photos/2026/04/f.jpg',
        photoToolLabelRequested: false,
        photoToolHumanDisplayName: 'ペンチ',
        photoToolHumanQuality: 'GOOD',
        photoToolHumanReviewedByUserId: 'admin-1',
        photoToolGallerySeed: true,
        returnedAt: expect.any(Date) as Date,
        photoTakenAt: expect.any(Date) as Date,
        photoToolHumanReviewedAt: expect.any(Date) as Date,
      }),
    });
    expect(galleryIndex.notifyAfterReview).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'loan-seed-1',
        photoToolHumanQuality: 'GOOD',
        photoToolHumanDisplayName: 'ペンチ',
      })
    );

    vi.useRealTimers();
  });

  it('deletes saved photo when loan create fails', async () => {
    vi.mocked(prisma.loan.create).mockRejectedValue(new Error('db down'));
    const galleryIndex = { notifyAfterReview: vi.fn() };
    const svc = new PhotoGallerySeedService({ galleryIndex: galleryIndex as never });

    await expect(
      svc.createFromUpload({
        jpegBuffer: jpegHeader,
        canonicalLabelRaw: 'ペンチ',
        reviewerUserId: 'admin-1',
      })
    ).rejects.toThrow('db down');

    expect(PhotoStorage.deletePhoto).toHaveBeenCalledWith('/api/storage/photos/2026/04/f.jpg');
    expect(galleryIndex.notifyAfterReview).not.toHaveBeenCalled();
  });
});
