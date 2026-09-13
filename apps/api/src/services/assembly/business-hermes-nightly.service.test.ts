import { describe, expect, it, vi } from 'vitest';
import { composeSourceQuotes, sourceUnits, reviewNightAnswer, nightlyTimings } from './business-hermes-nightly.service.js';

describe('Nightly source-only admission', () => {
  it('retains entire conditions and excludes source identity from selectable text', () => {
    const units = sourceUnits({ kind: 'work_instruction', id: 'one', steps: [{ step: 1, text: '設計へ相談してから加工。' }] }, 'one#');
    expect(units).toEqual({ 'one#/steps/0/text': '設計へ相談してから加工。' });
    expect(composeSourceQuotes({ quote_ids: ['one#/steps/0/text'] }, units)).toBe('設計へ相談してから加工。');
    for (const payload of [{ quote_ids: ['forged'] }, { quote_ids: ['one#/steps/0/text/substring'] },
      { quote_ids: ['one#/steps/0/text'], answer: '直接加工' }, { quote_ids: [] }, { quote_ids: ['one#/steps/0/text', 'one#/steps/0/text'] }]) {
      expect(() => composeSourceQuotes(payload, units)).toThrow();
    }
  });
  it('preserves source order and includes slow completed requests in daily timing', () => {
    expect(composeSourceQuotes({ quote_ids: ['second', 'first'] }, { first: '事前確認', second: '加工' })).toBe('事前確認\n\n加工');
    expect(nightlyTimings([[{ kind: 'business-hermes-learning-v1', phase: 'answer', elapsedMs: 14083 },
      { kind: 'business-hermes-learning-v1', phase: 'answer', elapsedMs: 4000 },
      { kind: 'business-hermes-learning-v1', phase: 'choice', elapsedMs: 100 }]])).toMatchObject({ count: 2, p95Ms: 14083, over10sRate: .5 });
  });
  it('does not accept a passing label with missing conditions', async () => {
    const completion = { complete: vi.fn().mockResolvedValue({ model: 'synthetic', rawText: JSON.stringify({ verdict: 'pass', reason: 'review', missing: ['相談条件'], unsupported: [] }) }) };
    const review = await reviewNightAnswer(completion, 'q', 'a', {}, new AbortController().signal);
    expect(review.verdict).toBe('fail');
    expect(completion.complete.mock.calls[0]![0]).toMatchObject({ useCase: 'business_hermes', enableThinking: false, jsonOutput: true });
  });
});
