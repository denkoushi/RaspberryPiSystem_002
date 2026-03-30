import { describe, expect, it, vi, beforeEach } from 'vitest';

import { PhotoToolLabelingService } from '../photo-tool-labeling.service.js';
import type {
  PendingPhotoLabelRepositoryPort,
  PhotoToolVisionImageSourcePort,
  VisionCompletionPort,
} from '../photo-tool-label-ports.js';

describe('PhotoToolLabelingService', () => {
  let repo: PendingPhotoLabelRepositoryPort;
  let visionImageSource: PhotoToolVisionImageSourcePort;
  let vision: VisionCompletionPort;

  beforeEach(() => {
    repo = {
      resetStaleClaims: vi.fn().mockResolvedValue(0),
      listPendingLoans: vi.fn().mockResolvedValue([{ id: 'loan-1', photoUrl: '/api/storage/photos/2025/01/x.jpg' }]),
      tryClaim: vi.fn().mockResolvedValue(true),
      completeWithLabel: vi.fn().mockResolvedValue(undefined),
      releaseClaim: vi.fn().mockResolvedValue(undefined),
    };
    visionImageSource = {
      readImageBytesForVision: vi.fn().mockResolvedValue(Buffer.from([1, 2, 3])),
    };
    vision = {
      complete: vi.fn().mockResolvedValue({ rawText: ' ペンチ ' }),
    };
  });

  it('skips batch when vision not configured', async () => {
    const svc = new PhotoToolLabelingService({
      repo,
      visionImageSource,
      vision,
      isVisionConfigured: () => false,
    });
    await svc.runBatch({ batchSize: 3, staleBefore: new Date(0) });
    expect(repo.listPendingLoans).not.toHaveBeenCalled();
  });

  it('completes with normalized label on success', async () => {
    const svc = new PhotoToolLabelingService({
      repo,
      visionImageSource,
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
      visionImageSource,
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
      visionImageSource,
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
      visionImageSource,
      vision,
      isVisionConfigured: () => true,
    });
    const staleBefore = new Date('2020-01-01');
    await svc.runBatch({ batchSize: 3, staleBefore });
    expect(repo.resetStaleClaims).toHaveBeenCalledWith(staleBefore);
  });

  it('シャドー補助が有効で assist が承認したとき 2 回目 VLM を呼び本番ラベルは従来どおり', async () => {
    const labelAssist = {
      evaluateForShadow: vi.fn().mockResolvedValue({
        shouldAssist: true,
        candidateLabels: ['専用工具'],
        reason: 'converged_neighbors',
        topDistance: 0.07,
        neighborCountAfterFilter: 2,
      }),
    };
    vi.mocked(vision.complete)
      .mockResolvedValueOnce({ rawText: ' ペンチ ' })
      .mockResolvedValueOnce({ rawText: ' 専用工具 ' });

    const svc = new PhotoToolLabelingService({
      repo,
      visionImageSource,
      vision,
      isVisionConfigured: () => true,
      labelAssist: labelAssist as never,
      shadowAssistEnabled: () => true,
    });
    await svc.runBatch({ batchSize: 3, staleBefore: new Date(0) });

    expect(vision.complete).toHaveBeenCalledTimes(2);
    expect(vision.complete.mock.calls[1][0].userText).toContain('【参考】');
    expect(repo.completeWithLabel).toHaveBeenCalledWith('loan-1', 'ペンチ');
  });

  it('assist が拒否したときは 1 回だけ VLM', async () => {
    const labelAssist = {
      evaluateForShadow: vi.fn().mockResolvedValue({
        shouldAssist: false,
        candidateLabels: [],
        reason: 'too_few_neighbors',
        topDistance: null,
        neighborCountAfterFilter: 0,
      }),
    };
    const svc = new PhotoToolLabelingService({
      repo,
      visionImageSource,
      vision,
      isVisionConfigured: () => true,
      labelAssist: labelAssist as never,
      shadowAssistEnabled: () => true,
    });
    await svc.runBatch({ batchSize: 3, staleBefore: new Date(0) });
    expect(vision.complete).toHaveBeenCalledTimes(1);
  });

  it('shadowAssistEnabled が false のときは補助を呼ばない', async () => {
    const labelAssist = { evaluateForShadow: vi.fn() };
    const svc = new PhotoToolLabelingService({
      repo,
      visionImageSource,
      vision,
      isVisionConfigured: () => true,
      labelAssist: labelAssist as never,
      shadowAssistEnabled: () => false,
    });
    await svc.runBatch({ batchSize: 3, staleBefore: new Date(0) });
    expect(labelAssist.evaluateForShadow).not.toHaveBeenCalled();
    expect(vision.complete).toHaveBeenCalledTimes(1);
  });

  it('calls localLlmRuntime ensureReady before vision and release after', async () => {
    const localLlmRuntime = {
      ensureReady: vi.fn().mockResolvedValue(undefined),
      release: vi.fn().mockResolvedValue(undefined),
      getMode: () => 'on_demand' as const,
    };
    const svc = new PhotoToolLabelingService({
      repo,
      visionImageSource,
      vision,
      isVisionConfigured: () => true,
      localLlmRuntime,
    });
    await svc.runBatch({ batchSize: 3, staleBefore: new Date(0) });
    expect(localLlmRuntime.ensureReady).toHaveBeenCalledWith('photo_label');
    expect(localLlmRuntime.release).toHaveBeenCalledWith('photo_label');
    expect(localLlmRuntime.ensureReady).toHaveBeenCalledTimes(1);
    expect(vi.mocked(vision.complete)).toHaveBeenCalledTimes(1);
    expect(localLlmRuntime.release).toHaveBeenCalledTimes(1);
  });
});
