import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn() }));
vi.mock('../../api/http', () => ({ api }));

import { getKnowledgeProcedure, knowledgeProcedureImagePath, listKnowledgeProcedures } from './knowledgeProcedureApi';
import { approveKnowledgeReview, getKnowledgePositionRanks, getKnowledgeReview, knowledgeReviewImagePath, listKnowledgePendingReviews, reportKnowledgeError, returnKnowledgeReview, saveKnowledgePositionRanks } from './knowledgeReviewApi';

beforeEach(() => {
  vi.resetAllMocks(); api.post.mockResolvedValue({ data: { procedure: {} } }); api.get.mockResolvedValue({ data: { procedure: {}, procedures: [] } }); api.put.mockResolvedValue({ data: {} });
});

describe('Knowledge clients keep tag UIDs in POST bodies', () => {
  it('uses POST for pending, detail, approval, return and error reporting without tag URLs', async () => {
    const reviewerTagUid = 'PRIVATE-TAG'; const body = { reviewerTagUid };
    await listKnowledgePendingReviews(body);
    await getKnowledgeReview('rev/1', body);
    await approveKnowledgeReview('rev/1', body);
    await returnKnowledgeReview('rev/1', { ...body, comment: '確認' });
    await reportKnowledgeError('proc/1', { reporterTagUid: reviewerTagUid, comment: '誤り' });
    expect(api.post.mock.calls).toEqual([
      ['/hermes-knowledge/reviews/pending', body, { signal: undefined }],
      ['/hermes-knowledge/reviews/rev%2F1/detail', body],
      ['/hermes-knowledge/reviews/rev%2F1/approve', body],
      ['/hermes-knowledge/reviews/rev%2F1/return', { reviewerTagUid, comment: '確認' }],
      ['/hermes-knowledge/procedures/proc%2F1/error-report', { reporterTagUid: reviewerTagUid, comment: '誤り' }],
    ]);
    expect(api.get).not.toHaveBeenCalled();
    for (const [url] of api.post.mock.calls) expect(url).not.toContain(reviewerTagUid);
  });
  it('reads published documents and mappings and PUTs the entire mapping', async () => {
    await listKnowledgeProcedures(); await getKnowledgeProcedure('proc/1'); await getKnowledgePositionRanks();
    const body = { ranks: [{ positionName: '主任', rank: 'leader' as const }] }; await saveKnowledgePositionRanks(body);
    expect(api.get.mock.calls.map(([url]) => url)).toEqual(['/hermes-knowledge/procedures', '/hermes-knowledge/procedures/proc%2F1', '/hermes-knowledge/position-ranks']);
    expect(api.put).toHaveBeenCalledWith('/hermes-knowledge/position-ranks', body);
    expect(knowledgeReviewImagePath('rev/1', 'img/1')).toBe('/api/hermes-knowledge/reviews/rev%2F1/images/img%2F1');
    expect(knowledgeProcedureImagePath('proc/1', 'img/1')).toBe('/api/hermes-knowledge/procedures/proc%2F1/images/img%2F1');
  });
});
