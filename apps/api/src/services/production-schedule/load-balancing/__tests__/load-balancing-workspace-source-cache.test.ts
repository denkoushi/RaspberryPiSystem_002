import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildLoadBalancingWorkspaceSourceKey,
  clearLoadBalancingWorkspaceSourceCacheForTests,
  readLoadBalancingWorkspaceSourceWithCache
} from '../load-balancing-workspace-source-cache.js';

const key = buildLoadBalancingWorkspaceSourceKey({
  siteKey: '第2工場',
  deviceScopeKey: 'kiosk-1',
  fromMonth: '2026-09',
  toMonth: '2027-02',
  today: '2026-09-30'
});

function source(label: string) {
  return { queryRows: [], machineNames: { S1: label } };
}

describe('readLoadBalancingWorkspaceSourceWithCache', () => {
  beforeEach(() => clearLoadBalancingWorkspaceSourceCacheForTests());

  it('reuses the loaded source while the generation token is unchanged', async () => {
    const load = vi.fn().mockResolvedValue(source('first'));

    const first = await readLoadBalancingWorkspaceSourceWithCache({ key, generationToken: 'g1', load });
    const second = await readLoadBalancingWorkspaceSourceWithCache({ key, generationToken: 'g1', load });

    expect(first.cacheHit).toBe(false);
    expect(second.cacheHit).toBe(true);
    expect(second.source.machineNames.S1).toBe('first');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('reloads when the generation token changes or the entry expires', async () => {
    let clock = 0;
    const now = () => clock;
    const load = vi.fn().mockResolvedValueOnce(source('a')).mockResolvedValueOnce(source('b')).mockResolvedValueOnce(source('c'));

    await readLoadBalancingWorkspaceSourceWithCache({ key, generationToken: 'g1', load, now });
    const changed = await readLoadBalancingWorkspaceSourceWithCache({ key, generationToken: 'g2', load, now });
    clock = 5 * 60 * 1000 + 1;
    const expired = await readLoadBalancingWorkspaceSourceWithCache({ key, generationToken: 'g2', load, now });

    expect(changed.source.machineNames.S1).toBe('b');
    expect(expired.source.machineNames.S1).toBe('c');
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('shares one load between concurrent requests and keeps other keys separate', async () => {
    let resolveLoad: (value: ReturnType<typeof source>) => void = () => {};
    const load = vi.fn(() => new Promise<ReturnType<typeof source>>((resolve) => (resolveLoad = resolve)));

    const a = readLoadBalancingWorkspaceSourceWithCache({ key, generationToken: 'g1', load });
    const b = readLoadBalancingWorkspaceSourceWithCache({ key, generationToken: 'g1', load });
    resolveLoad(source('shared'));
    const [first, second] = await Promise.all([a, b]);

    expect(load).toHaveBeenCalledTimes(1);
    expect(first.source).toBe(second.source);

    const otherKey = buildLoadBalancingWorkspaceSourceKey({
      siteKey: '第2工場',
      deviceScopeKey: 'kiosk-1',
      fromMonth: '2026-10',
      toMonth: '2027-03',
      today: '2026-09-30'
    });
    const otherLoad = vi.fn().mockResolvedValue(source('other'));
    await readLoadBalancingWorkspaceSourceWithCache({ key: otherKey, generationToken: 'g1', load: otherLoad });
    expect(otherLoad).toHaveBeenCalledTimes(1);
  });

  it('does not keep a failed load', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('db down')).mockResolvedValueOnce(source('ok'));

    await expect(readLoadBalancingWorkspaceSourceWithCache({ key, generationToken: 'g1', load })).rejects.toThrow('db down');
    const retried = await readLoadBalancingWorkspaceSourceWithCache({ key, generationToken: 'g1', load });

    expect(retried.source.machineNames.S1).toBe('ok');
  });
});
