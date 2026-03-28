import { describe, expect, it, vi, beforeEach } from 'vitest';

import { PhotoToolLabelingService } from '../photo-tool-labeling.service.js';
import type {
  PendingPhotoLabelRepositoryPort,
  ThumbnailReaderPort,
  VisionCompletionPort,
} from '../photo-tool-label-ports.js';

describe('PhotoToolLabelingService', () => {
  let repo: PendingPhotoLabelRepositoryPort;
  let thumbnailReader: ThumbnailReaderPort;
  let vision: VisionCompletionPort;

  beforeEach(() => {
    repo = {
      resetStaleClaims: vi.fn().mockResolvedValue(0),
      listPendingLoans: vi.fn().mockResolvedValue([{ id: 'loan-1', photoUrl: '/api/storage/photos/2025/01/x.jpg' }]),
      tryClaim: vi.fn().mockResolvedValue(true),
      completeWithLabel: vi.fn().mockResolvedValue(undefined),
      releaseClaim: vi.fn().mockResolvedValue(undefined),
    };
    thumbnailReader = {
      readThumbnail: vi.fn().mockResolvedValue(Buffer.from([1, 2, 3])),
    };
    vision = {
      complete: vi.fn().mockResolvedValue({ rawText: ' ペンチ ' }),
    };
  });

  it('skips batch when vision not configured', async () => {
    const svc = new PhotoToolLabelingService({
      repo,
      thumbnailReader,
      vision,
      isVisionConfigured: () => false,
    });
    await svc.runBatch({ batchSize: 3, staleBefore: new Date(0) });
    expect(repo.listPendingLoans).not.toHaveBeenCalled();
  });

  it('completes with normalized label on success', async () => {
    const svc = new PhotoToolLabelingService({
      repo,
      thumbnailReader,
      vision,
      isVisionConfigured: () => true,
    });
    await svc.runBatch({ batchSize: 3, staleBefore: new Date(0) });
    expect(vision.complete).toHaveBeenCalledTimes(1);
    expect(repo.completeWithLabel).toHaveBeenCalledWith('loan-1', 'ペンチ');
    expect(repo.releaseClaim).not.toHaveBeenCalled();
  });

  it('releases claim when normalized label is empty', async () => {
    vi.mocked(vision.complete).mockResolvedValue({ rawText: '   ' });
    const svc = new PhotoToolLabelingService({
      repo,
      thumbnailReader,
      vision,
      isVisionConfigured: () => true,
    });
    await svc.runBatch({ batchSize: 3, staleBefore: new Date(0) });
    expect(repo.completeWithLabel).not.toHaveBeenCalled();
    expect(repo.releaseClaim).toHaveBeenCalledWith('loan-1');
  });

  it('releases claim on vision error', async () => {
    vi.mocked(vision.complete).mockRejectedValue(new Error('upstream'));
    const svc = new PhotoToolLabelingService({
      repo,
      thumbnailReader,
      vision,
      isVisionConfigured: () => true,
    });
    await svc.runBatch({ batchSize: 3, staleBefore: new Date(0) });
    expect(repo.releaseClaim).toHaveBeenCalledWith('loan-1');
    expect(repo.completeWithLabel).not.toHaveBeenCalled();
  });

  it('resets stale claims first', async () => {
    vi.mocked(repo.resetStaleClaims).mockResolvedValue(2);
    const svc = new PhotoToolLabelingService({
      repo,
      thumbnailReader,
      vision,
      isVisionConfigured: () => true,
    });
    const staleBefore = new Date('2020-01-01');
    await svc.runBatch({ batchSize: 3, staleBefore });
    expect(repo.resetStaleClaims).toHaveBeenCalledWith(staleBefore);
  });
});
