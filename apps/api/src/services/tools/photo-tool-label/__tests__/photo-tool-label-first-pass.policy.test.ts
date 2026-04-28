import { describe, expect, it } from 'vitest';

import {
  augmentUserTextForFirstPass,
  FIRST_PASS_STRICT_DEFAULT_MAX_TOKENS,
  FIRST_PASS_STRICT_DEFAULT_TEMPERATURE,
  resolveFirstPassSampling,
} from '../photo-tool-label-first-pass.policy.js';

describe('photo-tool-label-first-pass.policy', () => {
  it('resolveFirstPassSampling uses inference defaults when strict off and overrides unset', () => {
    expect(
      resolveFirstPassSampling({
        strictMode: false,
        inferenceMaxTokens: 64,
        inferenceTemperature: 0.2,
      })
    ).toEqual({ maxTokens: 64, temperature: 0.2 });
  });

  it('resolveFirstPassSampling respects explicit overrides when strict off', () => {
    expect(
      resolveFirstPassSampling({
        strictMode: false,
        firstPassMaxTokens: 32,
        firstPassTemperature: 0.05,
        inferenceMaxTokens: 64,
        inferenceTemperature: 0.2,
      })
    ).toEqual({ maxTokens: 32, temperature: 0.05 });
  });

  it('resolveFirstPassSampling uses strict defaults when strict on and overrides unset', () => {
    expect(
      resolveFirstPassSampling({
        strictMode: true,
        inferenceMaxTokens: 64,
        inferenceTemperature: 0.2,
      })
    ).toEqual({
      maxTokens: FIRST_PASS_STRICT_DEFAULT_MAX_TOKENS,
      temperature: FIRST_PASS_STRICT_DEFAULT_TEMPERATURE,
    });
  });

  it('augmentUserTextForFirstPass appends rules only in strict mode', () => {
    const base = 'ツール名を答えて';
    expect(augmentUserTextForFirstPass(base, { strictMode: false })).toBe(base);
    const out = augmentUserTextForFirstPass(base, { strictMode: true });
    expect(out.startsWith(base)).toBe(true);
    expect(out).toContain('【回答ルール】');
    expect(out).toContain('撮影mode');
  });
});
