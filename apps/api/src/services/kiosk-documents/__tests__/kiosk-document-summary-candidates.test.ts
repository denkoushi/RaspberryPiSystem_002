import { describe, expect, it } from 'vitest';

import { buildSummaryCandidates } from '../kiosk-document-summary-candidates.js';

describe('buildSummaryCandidates', () => {
  it('returns empty triple for empty input', () => {
    expect(buildSummaryCandidates('')).toEqual([undefined, undefined, undefined]);
  });

  it('uses first paragraph and keyword when present', () => {
    const text = `第一段の説明がここにあります。続きもあり。\n\n第二段落。\n\n目的：この文書は試験用の長い説明文を含みます。さらに補足。`;
    const [a, b, c] = buildSummaryCandidates(text, 80);
    expect(a).toBeTruthy();
    expect(a!.length).toBeLessThanOrEqual(81);
    expect(b).toBeTruthy();
    expect(b).toContain('試験');
    expect(c === undefined || c.length <= 81).toBe(true);
  });

  it('falls back to clipped full text for short input', () => {
    const text = '短い';
    const [a] = buildSummaryCandidates(text, 120);
    expect(a).toBe('短い');
  });
});
