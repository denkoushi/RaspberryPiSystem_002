import { describe, expect, it } from 'vitest';

import { systemQueryKeys } from './system';

describe('systemQueryKeys', () => {
  it('preserves fixed keys and invalidation prefixes', () => {
    expect(systemQueryKeys.infoAll).toEqual(['system-info']);
    expect(systemQueryKeys.networkModeStatusAll).toEqual(['network-mode-status']);
    expect(systemQueryKeys.deployStatusAll).toEqual(['deploy-status']);
  });
});
