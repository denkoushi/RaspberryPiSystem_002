import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetch = vi.hoisted(() => vi.fn());
vi.mock('../../../../lib/prisma.js', () => ({ prisma: {} }));
vi.mock('../../row-resolver/index.js', () => ({ fetchMaxProductNoWinnerRowIdsForDashboard: fetch }));
import { clearLoadBalancingWinnerRowIdsCacheForTests, fetchLoadBalancingWinnerRowIds as read } from '../load-balancing-winner-row-ids.js';

describe('winner row IDs generation cache', () => {
  beforeEach(() => { clearLoadBalancingWinnerRowIdsCacheForTests(); fetch.mockReset(); });

  it('shares concurrent loads and reads once for the same token', async () => {
    let finish!: (ids: string[]) => void;
    fetch.mockImplementation(() => new Promise<string[]>((resolve) => { finish = resolve; }));
    const a = read('g1');
    const b = read('g1');
    finish(['r1']);
    expect(await a).toEqual(['r1']);
    expect(await b).toBe(await a);
    expect(await read('g1')).toBe(await a);
    expect(fetch).toHaveBeenCalledTimes(1);
    fetch.mockResolvedValue(['r2']);
    expect(await read('g2')).toEqual(['r2']);
    expect(fetch).toHaveBeenCalledTimes(2);
    await read('g1');
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('retries a failed load', async () => {
    fetch.mockRejectedValueOnce(new Error('db down')).mockResolvedValueOnce(['ok']);
    await expect(read('g1')).rejects.toThrow('db down');
    expect(await read('g1')).toEqual(['ok']);
  });

  it('does not overwrite a newer generation with a late result', async () => {
    let finish!: (ids: string[]) => void;
    fetch.mockImplementationOnce(() => new Promise<string[]>((resolve) => { finish = resolve; })).mockResolvedValue(['new']);
    const old = read('g1');
    await read('g2');
    finish(['old']);
    await old;
    expect(await read('g2')).toEqual(['new']);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
