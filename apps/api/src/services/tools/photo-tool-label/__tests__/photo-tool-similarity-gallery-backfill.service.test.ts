import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../lib/prisma.js', () => ({
  prisma: {
    loan: {
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from '../../../../lib/prisma.js';
import type { PhotoToolGalleryIndexService } from '../photo-tool-gallery-index.service.js';
import { PhotoToolSimilarityGalleryBackfillService } from '../photo-tool-similarity-gallery-backfill.service.js';

describe('PhotoToolSimilarityGalleryBackfillService', () => {
  beforeEach(() => {
    vi.mocked(prisma.loan.findMany).mockReset();
  });

  it('id 昇順でページングし syncFromSnapshot を呼ぶ', async () => {
    const syncFromSnapshot = vi.fn().mockResolvedValue(undefined);
    const galleryIndex = { syncFromSnapshot } as unknown as PhotoToolGalleryIndexService;

    vi.mocked(prisma.loan.findMany)
      .mockResolvedValueOnce([
        {
          id: 'loan-a',
          photoUrl: '/p.jpg',
          photoToolHumanQuality: 'GOOD' as const,
          photoToolHumanDisplayName: null,
          photoToolDisplayName: 'v',
          itemId: null,
          photoTakenAt: new Date(),
        },
      ])
      .mockResolvedValueOnce([]);

    const svc = new PhotoToolSimilarityGalleryBackfillService(galleryIndex);
    const stats = await svc.runAll({ batchSize: 10 });

    expect(syncFromSnapshot).toHaveBeenCalledTimes(1);
    expect(syncFromSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'loan-a', photoToolHumanQuality: 'GOOD' })
    );
    expect(stats.batches).toBe(1);
    expect(stats.loansSeen).toBe(1);
    expect(stats.succeeded).toBe(1);
    expect(stats.failed).toBe(0);
  });

  it('sync が失敗した行は failed に数える', async () => {
    const syncFromSnapshot = vi.fn().mockRejectedValue(new Error('embed failed'));
    const galleryIndex = { syncFromSnapshot } as unknown as PhotoToolGalleryIndexService;

    vi.mocked(prisma.loan.findMany)
      .mockResolvedValueOnce([
        {
          id: 'loan-b',
          photoUrl: '/p.jpg',
          photoToolHumanQuality: 'GOOD' as const,
          photoToolHumanDisplayName: null,
          photoToolDisplayName: 'v',
          itemId: null,
          photoTakenAt: new Date(),
        },
      ])
      .mockResolvedValueOnce([]);

    const svc = new PhotoToolSimilarityGalleryBackfillService(galleryIndex);
    const stats = await svc.runAll({ batchSize: 10 });

    expect(stats.succeeded).toBe(0);
    expect(stats.failed).toBe(1);
  });
});
