import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fakeHandles = { marker: 'scheduler-handles' };
const startPostListenSchedulers = vi.fn(async () => fakeHandles);
const stopPostListenSchedulers = vi.fn(async () => undefined);

vi.mock('../start-post-listen-schedulers.js', () => ({
  startPostListenSchedulers,
  stopPostListenSchedulers,
}));

describe('scheduler leader lease', () => {
  const cleanup: string[] = [];

  afterEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    for (const path of cleanup.splice(0)) await rm(path, { recursive: true, force: true });
    delete process.env.PI5_SCHEDULER_LEADER_ENABLED;
    delete process.env.PI5_SCHEDULER_LEASE_FILE;
    delete process.env.PI5_SCHEDULER_LEASE_INTERVAL_MS;
  });

  it('elects one owner and hands the lease to the second runtime after release', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pi5-scheduler-leader-'));
    cleanup.push(directory);
    const leaseFile = join(directory, 'leader');
    process.env.PI5_SCHEDULER_LEADER_ENABLED = '1';
    process.env.PI5_SCHEDULER_LEASE_FILE = leaseFile;
    process.env.PI5_SCHEDULER_LEASE_INTERVAL_MS = '10';

    const { startSchedulerRuntime } = await import('../scheduler-leader.js');
    const app = { signageRenderScheduler: { stop: vi.fn() } } as never;
    const first = await startSchedulerRuntime(app);
    const second = await startSchedulerRuntime(app);

    expect(startPostListenSchedulers).toHaveBeenCalledTimes(1);
    expect(await readFile(leaseFile, 'utf8')).toMatch(/^\d+:/);

    await first.stop();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(startPostListenSchedulers).toHaveBeenCalledTimes(2);

    await second.stop();
    expect(stopPostListenSchedulers).toHaveBeenCalledTimes(2);
  });
});
