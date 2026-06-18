import { describe, expect, it, vi } from 'vitest';

import { fetchFkojunstStatusMailSourceRowsOrdered } from '../../production-schedule/fkojunst-status-mail-source-rows.reader.js';

describe('fetchFkojunstStatusMailSourceRowsOrdered reader visibility', () => {
  it('does not treat rows tied to a PROCESSING ingest run as authoritative', async () => {
    const findMany = vi.fn(async () => [
      {
        id: 'visible-row',
        rowData: { FKojun: 'visible' },
        createdAt: new Date('2026-06-10T00:00:00.000Z'),
        updatedAt: new Date('2026-06-10T00:00:00.000Z'),
        sourceRowOrdinal: 1,
        sourceIngestRunStartedAt: new Date('2026-06-10T00:00:00.000Z'),
        sourceIngestRun: { completedAt: new Date('2026-06-10T01:00:00.000Z') },
      },
    ]);

    await fetchFkojunstStatusMailSourceRowsOrdered({
      csvDashboardRow: { findMany },
    } as never);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          csvDashboardId: expect.any(String),
          OR: [
            { sourceIngestRunId: null },
            { sourceIngestRun: { status: 'COMPLETED', completedAt: { not: null } } },
          ],
        },
      })
    );
  });
});
