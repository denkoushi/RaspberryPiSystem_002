import { describe, expect, it } from 'vitest';

import { outsourcingCandidatesBodySchema } from '../load-balancing.js';

describe('outsourcingCandidatesBodySchema', () => {
  it('maxCandidates 500 を受け付ける', () => {
    const parsed = outsourcingCandidatesBodySchema.parse({
      month: '2026-05',
      maxCandidates: 500,
    });

    expect(parsed.maxCandidates).toBe(500);
  });

  it('maxCandidates 501 は reject する', () => {
    expect(() =>
      outsourcingCandidatesBodySchema.parse({
        month: '2026-05',
        maxCandidates: 501,
      })
    ).toThrow();
  });
});
