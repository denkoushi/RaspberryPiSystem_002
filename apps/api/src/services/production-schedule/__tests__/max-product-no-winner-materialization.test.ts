import { describe, expect, it, vi } from 'vitest';

import { fetchMaxProductNoWinnerRowIdsForDashboard } from '../row-resolver/max-product-no-winner-materialization.js';

describe('fetchMaxProductNoWinnerRowIdsForDashboard (unit)', () => {
  it('maps prisma rows into id strings', async () => {
    const queryRaw = vi.fn().mockResolvedValue([{ id: 'x' }, { id: 'y' }]);

    const ids = await fetchMaxProductNoWinnerRowIdsForDashboard({
      prisma: { $queryRaw: queryRaw as never },
      csvDashboardId: 'dashboard-test'
    });

    expect(ids).toEqual(['x', 'y']);
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });
});
