import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildLoadBalancingWorkspaceSourceKey,
  clearLoadBalancingWorkspaceSourceCacheForTests,
  readLoadBalancingWorkspaceSourceWithCache
} from '../load-balancing-workspace-source-cache.js';

const key = buildLoadBalancingWorkspaceSourceKey({
  dueSource: 'excel',
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
    clock = 30 * 60 * 1000;
    const expired = await readLoadBalancingWorkspaceSourceWithCache({ key, generationToken: 'g2', load, now });

    expect(changed.source.machineNames.S1).toBe('b');
    expect(expired.source.machineNames.S1).toBe('c');
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('keeps an unchanged generation past five minutes, with a fixed thirty-minute bound', async () => {
    let clock = 0;
    const load = vi.fn().mockResolvedValue(source('same'));
    const read = () => readLoadBalancingWorkspaceSourceWithCache({ key, generationToken: 'g1', load, now: () => clock });
    await read();
    clock = 5 * 60 * 1000 + 1;
    expect((await read()).cacheHit).toBe(true);
    clock = 30 * 60 * 1000 - 1;
    expect((await read()).cacheHit).toBe(true);
    clock += 1;
    expect((await read()).cacheHit).toBe(false);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('evicts the least recently used source after sixteen entries', async () => {
    const load = vi.fn().mockResolvedValue(source('bounded'));
    const read = (key: string) => readLoadBalancingWorkspaceSourceWithCache({ key, generationToken: 'g1', load });
    for (let i = 0; i < 16; i += 1) await read(String(i));
    await read('0');
    await read('16');
    expect((await read('0')).cacheHit).toBe(true);
    expect((await read('1')).cacheHit).toBe(false);
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
      dueSource: 'excel',
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

  it('does not reuse sources across due sources', async () => {
    const params = { siteKey: 'site', deviceScopeKey: 'device', fromMonth: '2026-09', toMonth: '2027-02', today: '2026-09-30' };
    const excelKey = buildLoadBalancingWorkspaceSourceKey({ ...params, dueSource: 'excel' });
    const scawKey = buildLoadBalancingWorkspaceSourceKey({ ...params, dueSource: 'scaw' });
    expect(excelKey).not.toBe(scawKey);
    await readLoadBalancingWorkspaceSourceWithCache({ key: excelKey, generationToken: 'g1', load: async () => source('excel') });
    const result = await readLoadBalancingWorkspaceSourceWithCache({ key: scawKey, generationToken: 'g1', load: async () => source('scaw') });
    expect(result.cacheHit).toBe(false);
    expect(result.source.machineNames.S1).toBe('scaw');
  });
});
