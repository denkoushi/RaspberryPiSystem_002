import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../../../lib/prisma.js';
import { PgPhotoToolSimilarityGalleryRepository } from '../pg-photo-tool-similarity-gallery.repository.js';

vi.mock('../../../../lib/prisma.js', () => ({
  prisma: {
    $queryRawUnsafe: vi.fn(),
    $executeRawUnsafe: vi.fn(),
  },
}));

describe('PgPhotoToolSimilarityGalleryRepository', () => {
  const modelId = "embeddinggemma2'current";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('近傍検索を現在のモデルIDの行に限定し、IDをパラメータで渡す', async () => {
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([
      { loanId: 'loan-a', canonicalLabel: 'ペンチ', distance: 0.1 },
    ]);
    const repository = new PgPhotoToolSimilarityGalleryRepository(3, modelId);

    const neighbors = await repository.findNearestNeighbors({
      queryEmbedding: [0, 0, 1],
      excludeLoanId: 'query-loan',
      limit: 5,
    });

    expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('AND g."embeddingModelId" = $4'),
      '[0.00000000,0.00000000,1.00000000]',
      'query-loan',
      5,
      modelId
    );
    const sql = vi.mocked(prisma.$queryRawUnsafe).mock.calls[0][0];
    expect(sql).toContain('WHERE g."loanId" <> $2');
    expect(sql).toContain('ORDER BY g."embedding" <=> $1::vector');
    expect(sql).toContain('LIMIT $3');
    expect(sql).not.toContain(modelId);
    expect(neighbors).toEqual([{ sourceLoanId: 'loan-a', canonicalLabel: 'ペンチ', distance: 0.1 }]);
  });

  it('ラベル件数を現在のモデルIDの行に限定し、IDをパラメータで渡す', async () => {
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([{ count: 12n }]);
    const repository = new PgPhotoToolSimilarityGalleryRepository(3, modelId);

    expect(await repository.countRowsByCanonicalLabel('ペンチ')).toBe(12);
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('AND g."embeddingModelId" = $2'),
      'ペンチ',
      modelId
    );
    const sql = vi.mocked(prisma.$queryRawUnsafe).mock.calls[0][0];
    expect(sql).toContain('WHERE BTRIM(g."canonicalLabel") = $1');
    expect(sql).not.toContain(modelId);
  });

  it('モデルID未設定でも生成でき、検索・件数集計はDBを呼ばず空を返す', async () => {
    const repository = new PgPhotoToolSimilarityGalleryRepository(3, undefined);

    expect(await repository.findNearestNeighbors({ queryEmbedding: [0, 0, 1], excludeLoanId: 'loan', limit: 5 })).toEqual([]);
    expect(await repository.countRowsByCanonicalLabel('ペンチ')).toBe(0);
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it('空ラベルの件数はDBを呼ばず0を返す', async () => {
    const repository = new PgPhotoToolSimilarityGalleryRepository(3, modelId);

    expect(await repository.countRowsByCanonicalLabel('')).toBe(0);
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
  });
});
