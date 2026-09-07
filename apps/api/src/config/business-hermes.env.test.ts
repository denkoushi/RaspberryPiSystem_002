import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { businessHermesEnvShape } from './env/business-hermes.js';

describe('business Hermes environment shape', () => {
  const schema = z.object(businessHermesEnvShape);

  it('treats blank endpoint fields as unset', () => {
    const parsed = schema.parse({ BUSINESS_HERMES_BASE_URL: '  ', BUSINESS_HERMES_API_KEY: '', BUSINESS_HERMES_MODEL: '   ' });
    expect(parsed.BUSINESS_HERMES_BASE_URL).toBeUndefined();
    expect(parsed.BUSINESS_HERMES_API_KEY).toBeUndefined();
    expect(parsed.BUSINESS_HERMES_MODEL).toBeUndefined();
  });

  it('requires an origin URL without a path', () => {
    expect(() => schema.parse({ BUSINESS_HERMES_BASE_URL: 'https://hermes.example/api' })).toThrow();
    expect(schema.parse({ BUSINESS_HERMES_BASE_URL: 'https://hermes.example' }).BUSINESS_HERMES_BASE_URL).toBe('https://hermes.example');
  });

  it('keeps the existing guide deadline and gives chat its independent 60s default', () => {
    const parsed = schema.parse({});

    expect(parsed.BUSINESS_HERMES_TIMEOUT_MS).toBe(8_000);
    expect(parsed.BUSINESS_HERMES_CHAT_TIMEOUT_MS).toBe(60_000);
    expect(schema.parse({
      BUSINESS_HERMES_TIMEOUT_MS: '30000',
      BUSINESS_HERMES_CHAT_TIMEOUT_MS: '60000'
    })).toMatchObject({ BUSINESS_HERMES_TIMEOUT_MS: 30_000, BUSINESS_HERMES_CHAT_TIMEOUT_MS: 60_000 });
  });

  it('rejects timeout values above each contract bound', () => {
    expect(() => schema.parse({ BUSINESS_HERMES_TIMEOUT_MS: '30001' })).toThrow();
    expect(() => schema.parse({ BUSINESS_HERMES_CHAT_TIMEOUT_MS: '60001' })).toThrow();
  });
});
