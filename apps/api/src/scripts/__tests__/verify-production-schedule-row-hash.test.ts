import { expect, it, vi } from 'vitest';
import { verifyProductionScheduleRowHash } from '../verify-production-schedule-row-hash.js';

it('returns zero-count migration checks and informational counts for an empty database', async () => {
  const client = { $queryRaw: vi.fn()
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ multipleMatches: 0, noMatch: 0 }]) };
  const result = await verifyProductionScheduleRowHash(client as never);
  const empty = { count: 0, sampleIds: [] };
  expect(result.checks).toEqual({
    missingKey: empty, invalidKeyType: empty, riskyCharacters: empty, duplicateHash: empty,
    overrideCollision: empty, arrivalCollision: empty, firstProcessArrivalCollision: empty,
  });
  expect(result.sessakuPieceSets).toEqual({ multipleMatches: 0, noMatch: 0 });
});
