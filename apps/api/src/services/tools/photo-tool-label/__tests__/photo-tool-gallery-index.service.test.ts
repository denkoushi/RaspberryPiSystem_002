import { describe, expect, it, vi } from 'vitest';

import { PhotoToolGalleryIndexService } from '../photo-tool-gallery-index.service.js';

vi.mock('../../../../config/env.js', () => ({
  env: {
    PHOTO_TOOL_EMBEDDING_ENABLED: true,
    PHOTO_TOOL_EMBEDDING_MODEL_ID: 'test-embed-model',
    PHOTO_TOOL_SIMILARITY_PIPELINE_VERSION: 'vision_jpeg_v1',
    LOG_LEVEL: 'info',
  },
}));

vi.mock('../../../../lib/logger.js', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('PhotoToolGalleryIndexService', () => {
  it('GOOD のとき vision→embedding→upsert を行う', async () => {
    const embedJpeg = vi.fn().mockResolvedValue([0.1, 0.2]);
    const upsert = vi.fn().mockResolvedValue(undefined);
    const deleteByLoanId = vi.fn();
    const readVision = vi.fn().mockResolvedValue(Buffer.from([1, 2, 3]));

    const svc = new PhotoToolGalleryIndexService(
      { embedJpeg },
      { upsert, deleteByLoanId },
      { readImageBytesForVision: readVision }
    );

    svc.notifyAfterReview({
      id: 'loan-a',
      photoUrl: '/api/storage/photos/2025/01/x.jpg',
      photoToolHumanQuality: 'GOOD',
      photoToolHumanDisplayName: ' ペンチ ',
      photoToolDisplayName: 'ラジペン',
      itemId: null,
      photoTakenAt: new Date(),
    });

    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(deleteByLoanId).not.toHaveBeenCalled();
    expect(readVision).toHaveBeenCalledWith('/api/storage/photos/2025/01/x.jpg');
    expect(embedJpeg).toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        loanId: 'loan-a',
        canonicalLabel: 'ペンチ',
        embeddingModelId: 'test-embed-model',
        imagePipelineVersion: 'vision_jpeg_v1',
      })
    );
  });

  it('非 GOOD のときギャラリー行を削除する', async () => {
    const embedJpeg = vi.fn();
    const upsert = vi.fn();
    const deleteByLoanId = vi.fn().mockResolvedValue(undefined);
    const readVision = vi.fn();

    const svc = new PhotoToolGalleryIndexService(
      { embedJpeg },
      { upsert, deleteByLoanId },
      { readImageBytesForVision: readVision }
    );

    svc.notifyAfterReview({
      id: 'loan-b',
      photoUrl: '/api/storage/photos/2025/01/x.jpg',
      photoToolHumanQuality: 'BAD',
      photoToolHumanDisplayName: null,
      photoToolDisplayName: 'x',
      itemId: null,
      photoTakenAt: new Date(),
    });

    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(deleteByLoanId).toHaveBeenCalledWith('loan-b');
    expect(readVision).not.toHaveBeenCalled();
    expect(embedJpeg).not.toHaveBeenCalled();
  });
});
