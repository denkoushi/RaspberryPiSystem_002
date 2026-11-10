import { describe, expect, it, vi } from 'vitest';

import { productionScheduleLeaderboardPhasedQuerySchema, productionScheduleLeaderboardShellContinuationFieldsSchema } from '../../../routes/kiosk/production-schedule/shared.js';
import { buildLeaderboardShellFilterFingerprint } from '../leaderboard/leaderboard-shell-snapshot-fingerprint.js';
import { readLeaderboardShellSnapshotGenerationTokenDetails } from '../leaderboard/leaderboard-shell-snapshot-generation.js';

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../../lib/prisma.js', () => ({ prisma: { $queryRaw: mocks.query } }));

describe('board due source snapshot contract', () => {
  it('validates/defaults the leaderboard shell and continuation source', () => {
    for (const schema of [productionScheduleLeaderboardPhasedQuerySchema, productionScheduleLeaderboardShellContinuationFieldsSchema]) {
      expect(schema.parse({}).dueSource).toBe('excel');
      expect(schema.parse({ dueSource: 'scaw' }).dueSource).toBe('scaw');
      expect(() => schema.parse({ dueSource: 'other' })).toThrow();
    }
  });

  it('prevents reusing a shell snapshot across sources and normalizes an omitted source', () => {
    const filters = { locationKey: 'test', queryText: '', productNos: [], resourceCds: [], assignedOnlyCds: [], hasNoteOnly: false, hasDueDateOnly: false, allowResourceOnly: true };
    expect(buildLeaderboardShellFilterFingerprint(filters)).toBe(buildLeaderboardShellFilterFingerprint({ ...filters, dueSource: 'excel' }));
    expect(buildLeaderboardShellFilterFingerprint(filters)).not.toBe(buildLeaderboardShellFilterFingerprint({ ...filters, dueSource: 'scaw' }));
  });

  it('invalidates cached boards after Excel changes without changing the empty-Excel token shape', async () => {
    mocks.query.mockResolvedValueOnce([{ rowsRevision: 1n, excelDueUpdatedAt: null, excelDueCount: 0n }]);
    const empty = await readLeaderboardShellSnapshotGenerationTokenDetails({ fkojunstStatusMailRowsRevision: '1' });
    expect(JSON.parse(empty.generationToken)).not.toHaveProperty('excelDueUpdatedAt');
    mocks.query.mockResolvedValueOnce([{ rowsRevision: 1n, excelDueUpdatedAt: new Date('2026-11-04Z'), excelDueCount: 1n }]);
    const populated = await readLeaderboardShellSnapshotGenerationTokenDetails({ fkojunstStatusMailRowsRevision: '1' });
    expect(populated.generationToken).not.toBe(empty.generationToken);
    expect(JSON.parse(populated.generationToken)).toMatchObject({ excelDueCount: '1' });
  });
});
