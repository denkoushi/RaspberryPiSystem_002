import { describe, expect, it } from 'vitest';

import { parseInferenceProvidersJsonQuiet } from '../inference-providers-json.schema.js';

describe('parseInferenceProvidersJsonQuiet', () => {
  it('ignores unknown legacy keys without rejecting valid provider configuration', () => {
    const provider = {
      id: 'default',
      baseUrl: 'http://localhost:8080',
      sharedToken: 'test-token',
      defaultModel: 'test-model',
      runtimeControl: { mode: 'always_on' },
    };
    const parsed = parseInferenceProvidersJsonQuiet(JSON.stringify([{
      ...provider,
      retired_chat: { providerId: 'removed-provider' },
      runtimeControl: { ...provider.runtimeControl, retired_chat: true },
    }]));

    expect(parsed).toEqual([{ ...provider, timeoutMs: 60_000 }]);
    expect(parsed?.[0]).not.toHaveProperty('retired_chat');
    expect(parsed?.[0].runtimeControl).not.toHaveProperty('retired_chat');
  });
});
