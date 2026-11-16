import { describe, expect, it, vi } from 'vitest';
import { ProductionSchedulePartNameLookupRebuilder } from '../production-schedule-part-name-lookup-rebuild.js';

vi.mock('../../../lib/prisma.js', () => ({ prisma: {} }));
vi.mock('../../../lib/logger.js', () => ({ logger: { warn: vi.fn() } }));

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};

describe('part name lookup rebuild queue', () => {
  it('coalesces multiple requests during a rebuild into exactly one additional pass', async () => {
    const first = deferred();
    const second = deferred();
    const run = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const queue = new ProductionSchedulePartNameLookupRebuilder(run);
    const active = queue.request();
    await Promise.resolve();
    expect(run).toHaveBeenCalledTimes(1);
    expect(queue.request()).toBe(active);
    queue.request(); queue.request();
    first.resolve(); await Promise.resolve();
    expect(run).toHaveBeenCalledTimes(2);
    second.resolve(); await active;
    expect(run).toHaveBeenCalledTimes(2);
    await queue.request();
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('logs failure, completes the pending pass, and accepts later requests', async () => {
    const first = deferred();
    const run = vi.fn().mockReturnValueOnce(first.promise.then(() => { throw new Error('failed'); })).mockResolvedValue(undefined);
    const queue = new ProductionSchedulePartNameLookupRebuilder(run);
    const active = queue.request(); await Promise.resolve();
    queue.request(); first.resolve();
    await expect(active).resolves.toBeUndefined();
    expect(run).toHaveBeenCalledTimes(2);
    await queue.request(); expect(run).toHaveBeenCalledTimes(3);
  });

  it('contains synchronous failures without delaying the requesting caller', async () => {
    const run = vi.fn(() => { throw new Error('sync failure'); });
    const queue = new ProductionSchedulePartNameLookupRebuilder(run);
    const active = queue.request();
    expect(run).not.toHaveBeenCalled();
    await expect(active).resolves.toBeUndefined();
  });
});
