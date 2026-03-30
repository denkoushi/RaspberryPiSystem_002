import { describe, expect, it } from 'vitest';

import type { InferenceProviderDefinition } from '../../config/inference-provider.types.js';
import { InferenceRouter } from '../inference-router.js';

const providers: InferenceProviderDefinition[] = [
  {
    id: 'default',
    baseUrl: 'http://localhost:1',
    sharedToken: 't',
    timeoutMs: 5000,
    defaultModel: 'model-a',
  },
  {
    id: 'sub',
    baseUrl: 'http://localhost:2',
    sharedToken: 't2',
    timeoutMs: 8000,
    defaultModel: 'model-b',
  },
];

describe('InferenceRouter', () => {
  it('resolves photo_label to configured provider and defaultModel', () => {
    const router = new InferenceRouter({
      providers,
      routes: {
        photo_label: { providerId: 'sub' },
        document_summary: { providerId: 'default' },
      },
    });
    const r = router.resolve('photo_label');
    expect(r.provider.id).toBe('sub');
    expect(r.model).toBe('model-b');
  });

  it('uses modelOverride when set', () => {
    const router = new InferenceRouter({
      providers,
      routes: {
        photo_label: { providerId: 'default', modelOverride: 'override-x' },
        document_summary: { providerId: 'default' },
      },
    });
    expect(router.resolve('photo_label').model).toBe('override-x');
  });

  it('isResolvable is false when providerId missing', () => {
    const router = new InferenceRouter({
      providers,
      routes: {
        photo_label: { providerId: 'nope' },
        document_summary: { providerId: 'default' },
      },
    });
    expect(router.isResolvable('photo_label')).toBe(false);
    expect(router.isResolvable('document_summary')).toBe(true);
  });
});
