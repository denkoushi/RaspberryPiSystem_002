import { describe, expect, it } from 'vitest';

import { synthesizeProvidersFromLegacyLlm, tryParseInferenceProvidersJson } from '../parse-inference-providers.js';

describe('parse-inference-providers', () => {
  it('parses valid JSON array', () => {
    const raw = JSON.stringify([
      { id: 'p1', baseUrl: 'http://a:1', sharedToken: 'x', defaultModel: 'm1', timeoutMs: 3000 },
    ]);
    const got = tryParseInferenceProvidersJson(raw);
    expect(got).toEqual([
      {
        id: 'p1',
        baseUrl: 'http://a:1',
        sharedToken: 'x',
        defaultModel: 'm1',
        timeoutMs: 3000,
      },
    ]);
  });

  it('returns null on invalid JSON', () => {
    expect(tryParseInferenceProvidersJson('not json')).toBeNull();
  });

  it('synthesizes from legacy when all fields present', () => {
    expect(
      synthesizeProvidersFromLegacyLlm({
        baseUrl: 'http://h:1',
        sharedToken: 'tok',
        model: 'mm',
        timeoutMs: 9000,
      })
    ).toEqual([
      {
        id: 'default',
        baseUrl: 'http://h:1',
        sharedToken: 'tok',
        defaultModel: 'mm',
        timeoutMs: 9000,
      },
    ]);
  });

  it('synthesizes empty when legacy incomplete', () => {
    expect(synthesizeProvidersFromLegacyLlm({ baseUrl: 'http://h:1', timeoutMs: 1 })).toEqual([]);
  });
});
