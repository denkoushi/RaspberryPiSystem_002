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
});
