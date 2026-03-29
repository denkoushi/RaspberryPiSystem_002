import { describe, expect, it, vi, beforeEach } from 'vitest';

import { prisma } from '../../../../lib/prisma.js';
import { PhotoToolSimilarCandidateService } from '../photo-tool-similar-candidate.service.js';

vi.mock('../../../../lib/prisma.js', () => ({
  prisma: {
    loan: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock('../../../../config/env.js', () => ({
  env: {
    PHOTO_TOOL_EMBEDDING_ENABLED: true,
    PHOTO_TOOL_SIMILARITY_MAX_CANDIDATES: 5,
    PHOTO_TOOL_SIMILARITY_MAX_COSINE_DISTANCE: 0.25,
  },
}));

describe('PhotoToolSimilarCandidateService', () => {
  const vision = { readImageBytesForVision: vi.fn().mockResolvedValue(Buffer.from([9])) };
  const embedding = { embedJpeg: vi.fn().mockResolvedValue([0, 0, 1]) };

  beforeEach(() => {
    vi.mocked(prisma.loan.findFirst).mockReset();
    vision.readImageBytesForVision.mockClear();
    embedding.embedJpeg.mockClear();
  });

  it('embedding が無いときは空配列を返す', async () => {
    const gallery = { findNearestNeighbors: vi.fn() };
    const svc = new PhotoToolSimilarCandidateService(null, gallery as never, vision as never);
    const out = await svc.getCandidates('any');
    expect(out.candidates).toEqual([]);
    expect(gallery.findNearestNeighbors).not.toHaveBeenCalled();
  });

  it('貸出が無いときは 404', async () => {
    vi.mocked(prisma.loan.findFirst).mockResolvedValue(null);
    const gallery = { findNearestNeighbors: vi.fn() };
    const svc = new PhotoToolSimilarCandidateService(embedding, gallery as never, vision as never);
    await expect(svc.getCandidates('00000000-0000-4000-8000-000000000001')).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('写真持出でないときは 400', async () => {
    vi.mocked(prisma.loan.findFirst).mockResolvedValue({
      id: 'l1',
      photoUrl: null,
      itemId: null,
      photoTakenAt: new Date(),
    } as never);
    const gallery = { findNearestNeighbors: vi.fn() };
    const svc = new PhotoToolSimilarCandidateService(embedding, gallery as never, vision as never);
    await expect(svc.getCandidates('l1')).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it('近傍を閾値で切り詰めて返す', async () => {
    vi.mocked(prisma.loan.findFirst).mockResolvedValue({
      id: 'target',
      photoUrl: '/api/storage/photos/2025/01/x.jpg',
      itemId: null,
      photoTakenAt: new Date(),
    } as never);

    const gallery = {
      findNearestNeighbors: vi.fn().mockResolvedValue([
        { sourceLoanId: 'a', canonicalLabel: 'A', distance: 0.1 },
        { sourceLoanId: 'b', canonicalLabel: 'B', distance: 0.5 },
      ]),
    };

    const svc = new PhotoToolSimilarCandidateService(embedding, gallery as never, vision as never);
    const out = await svc.getCandidates('target');

    expect(out.candidates).toHaveLength(1);
    expect(out.candidates[0]).toMatchObject({
      sourceLoanId: 'a',
      canonicalLabel: 'A',
      cosineDistance: 0.1,
      score: 0.9,
    });
  });
});
