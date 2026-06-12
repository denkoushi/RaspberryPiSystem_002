import { describe, expect, it } from 'vitest';

import { withCsvDashboardIngestLock } from '../csv-dashboard-ingest-lock.js';

const nextTick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('withCsvDashboardIngestLock', () => {
  it('serializes work for the same dashboard without blocking other dashboards', async () => {
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstRelease = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = withCsvDashboardIngestLock('dashboard-a', async () => {
      events.push('a1:start');
      await firstRelease;
      events.push('a1:end');
      return 'a1';
    });

    const second = withCsvDashboardIngestLock('dashboard-a', async () => {
      events.push('a2:start');
      return 'a2';
    });

    const other = withCsvDashboardIngestLock('dashboard-b', async () => {
      events.push('b:start');
      return 'b';
    });

    await nextTick();
    expect(events).toEqual(['a1:start', 'b:start']);

    releaseFirst();
    await expect(Promise.all([first, second, other])).resolves.toEqual(['a1', 'a2', 'b']);
    expect(events).toEqual(['a1:start', 'b:start', 'a1:end', 'a2:start']);
  });
});
