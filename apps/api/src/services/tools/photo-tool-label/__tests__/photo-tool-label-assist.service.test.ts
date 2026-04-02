import { describe, expect, it, vi, beforeEach } from 'vitest';

import { PhotoToolLabelAssistService } from '../photo-tool-label-assist.service.js';

vi.mock('../../../../config/env.js', () => ({
  env: {
    PHOTO_TOOL_EMBEDDING_ENABLED: true,
    PHOTO_TOOL_LABEL_ASSIST_MAX_COSINE_DISTANCE: 0.25,
    PHOTO_TOOL_LABEL_ASSIST_MIN_NEIGHBORS: 2,
    PHOTO_TOOL_LABEL_ASSIST_CONVERGENCE_TOP_K: 2,
    PHOTO_TOOL_LABEL_ASSIST_QUERY_NEIGHBOR_LIMIT: 40,
    PHOTO_TOOL_LABEL_ASSIST_PROMPT_MAX_LABELS: 3,
  },
}));

describe('PhotoToolLabelAssistService', () => {
  const jpeg = Buffer.from([1, 2, 3]);
  const embedding = { embedJpeg: vi.fn().mockResolvedValue([0, 0, 1]) };

  beforeEach(() => {
    embedding.embedJpeg.mockClear();
  });

  it('埋め込みアダプタが無いときは embedding_disabled', async () => {
    const gallery = { findNearestNeighbors: vi.fn() };
    const svc = new PhotoToolLabelAssistService(null, gallery as never);
    const out = await svc.evaluateForShadow({ loanId: 'l1', photoUrl: '/x', queryJpegBytes: jpeg });
    expect(out.shouldAssist).toBe(false);
    expect(out.convergedCanonicalLabel).toBeNull();
    expect(out.reason).toBe('embedding_disabled');
    expect(embedding.embedJpeg).not.toHaveBeenCalled();
    expect(gallery.findNearestNeighbors).not.toHaveBeenCalled();
  });

  it('embed が失敗したら embed_failed', async () => {
    embedding.embedJpeg.mockRejectedValueOnce(new Error('net'));
    const gallery = { findNearestNeighbors: vi.fn() };
    const svc = new PhotoToolLabelAssistService(embedding as never, gallery as never);
    const out = await svc.evaluateForShadow({ loanId: 'l1', photoUrl: '/x', queryJpegBytes: jpeg });
    expect(out.shouldAssist).toBe(false);
    expect(out.convergedCanonicalLabel).toBeNull();
    expect(out.reason).toBe('embed_failed');
  });

  it('近傍が少なすぎるときは too_few_neighbors', async () => {
    const gallery = {
      findNearestNeighbors: vi.fn().mockResolvedValue([{ sourceLoanId: 'a', canonicalLabel: 'A', distance: 0.1 }]),
    };
    const svc = new PhotoToolLabelAssistService(embedding as never, gallery as never);
    const out = await svc.evaluateForShadow({ loanId: 'target', photoUrl: '/x', queryJpegBytes: jpeg });
    expect(out.shouldAssist).toBe(false);
    expect(out.convergedCanonicalLabel).toBeNull();
    expect(out.reason).toBe('too_few_neighbors');
  });

  it('先頭K件のラベルが揃わないときは labels_not_converged', async () => {
    const gallery = {
      findNearestNeighbors: vi.fn().mockResolvedValue([
        { sourceLoanId: 'a', canonicalLabel: 'A', distance: 0.1 },
        { sourceLoanId: 'b', canonicalLabel: 'B', distance: 0.11 },
      ]),
    };
    const svc = new PhotoToolLabelAssistService(embedding as never, gallery as never);
    const out = await svc.evaluateForShadow({ loanId: 'target', photoUrl: '/x', queryJpegBytes: jpeg });
    expect(out.shouldAssist).toBe(false);
    expect(out.convergedCanonicalLabel).toBeNull();
    expect(out.reason).toBe('labels_not_converged');
  });

  it('撮影mode は補助候補から除外され件数が減る', async () => {
    const gallery = {
      findNearestNeighbors: vi.fn().mockResolvedValue([
        { sourceLoanId: 'a', canonicalLabel: '撮影mode', distance: 0.05 },
        { sourceLoanId: 'b', canonicalLabel: '撮影mode', distance: 0.06 },
      ]),
    };
    const svc = new PhotoToolLabelAssistService(embedding as never, gallery as never);
    const out = await svc.evaluateForShadow({ loanId: 'target', photoUrl: '/x', queryJpegBytes: jpeg });
    expect(out.shouldAssist).toBe(false);
    expect(out.convergedCanonicalLabel).toBeNull();
    expect(out.neighborCountAfterFilter).toBe(0);
    expect(out.reason).toBe('too_few_neighbors');
  });

  it('収束したとき shouldAssist と candidateLabels', async () => {
    const gallery = {
      findNearestNeighbors: vi.fn().mockResolvedValue([
        { sourceLoanId: 'a', canonicalLabel: '専用ゲージ', distance: 0.08 },
        { sourceLoanId: 'b', canonicalLabel: '専用ゲージ', distance: 0.09 },
        { sourceLoanId: 'c', canonicalLabel: '専用ゲージ', distance: 0.1 },
      ]),
    };
    const svc = new PhotoToolLabelAssistService(embedding as never, gallery as never);
    const out = await svc.evaluateForShadow({ loanId: 'target', photoUrl: '/x', queryJpegBytes: jpeg });
    expect(out.shouldAssist).toBe(true);
    expect(out.reason).toBe('converged_neighbors');
    expect(out.convergedCanonicalLabel).toBe('専用ゲージ');
    expect(out.candidateLabels).toEqual(['専用ゲージ']);
    expect(out.topDistance).toBe(0.08);
    expect(out.neighborCountAfterFilter).toBe(3);
  });
});
