import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../../../lib/prisma.js';
import { findSupplementMachineNamesForMissing } from '../../../production-schedule/seiban-machine-name-supplement-backfill.js';
import { resolveFseibansMatchingMachineNameQuery } from '../part-search-machine-name-fseibans.service.js';

vi.mock('../../../../lib/prisma.js', () => ({ prisma: { $queryRaw: vi.fn() } }));
vi.mock('../../../production-schedule/seiban-machine-name-supplement-backfill.js', () => ({ findSupplementMachineNamesForMissing: vi.fn() }));

beforeEach(() => vi.resetAllMocks());

describe('part-search machine names', () => {
  it('folds both schedule and supplement kana while preserving uppercase half-width comparison', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      { fseiban: 'BE01', machineName: 'ＤＡＤテーブル' },
      { fseiban: 'BE02', machineName: null },
      { fseiban: 'BE03', machineName: 'DADカバー' },
      { fseiban: ' ', machineName: 'DADテーブル' }
    ]);
    vi.mocked(findSupplementMachineNamesForMissing).mockResolvedValue(new Map([['BE02', 'dadてーぶる']]));
    await expect(resolveFseibansMatchingMachineNameQuery('dadてふる')).resolves.toEqual(new Set(['BE01', 'BE02']));
  });
  it('does not fetch for an empty folded query', async () => {
    await expect(resolveFseibansMatchingMachineNameQuery('ーｰ')).resolves.toEqual(new Set());
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});
