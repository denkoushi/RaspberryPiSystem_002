import { describe, expect, it } from 'vitest';

import { shouldRequestDrawingOcrCandidates } from './drawingOcrCandidateState';

const base = { requestId: 1, loading: false, status: null, candidates: [], error: null };

describe('shouldRequestDrawingOcrCandidates', () => {
  it('まだ取っていない点だけ取りに行く', () => {
    expect(shouldRequestDrawingOcrCandidates(undefined)).toBe(true);
  });
  it('取得中・取得済みは取りに行かない', () => {
    expect(shouldRequestDrawingOcrCandidates({ ...base, loading: true })).toBe(false);
    expect(shouldRequestDrawingOcrCandidates({ ...base, status: 'completed' })).toBe(false);
  });
  it('失敗・処理中・候補0件の応答のあとも送り直さない', () => {
    expect(shouldRequestDrawingOcrCandidates({ ...base, error: 'OCR候補なし' })).toBe(false);
    expect(shouldRequestDrawingOcrCandidates({ ...base, status: 'failed' })).toBe(false);
    expect(shouldRequestDrawingOcrCandidates({ ...base, status: 'processing' })).toBe(false);
    expect(shouldRequestDrawingOcrCandidates({ ...base, status: 'pending' })).toBe(false);
  });
});
