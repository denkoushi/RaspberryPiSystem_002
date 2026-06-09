import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import {
  resetMachineNameFseibanMatchCaches,
  resolveMatchingFseibansByNormalizedMachineName,
} from '../machine-name-fseiban-match.service.js';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    $queryRaw: vi.fn(),
    productionScheduleSeibanMachineNameSupplement: {
      findMany: vi.fn(),
    },
  },
}));

describe('machine-name-fseiban-match.service', () => {
  beforeEach(() => {
    vi.mocked(prisma.$queryRaw).mockReset();
    vi.mocked(prisma.productionScheduleSeibanMachineNameSupplement.findMany).mockReset();
    resetMachineNameFseibanMatchCaches();
    process.env.PRODUCTION_SCHEDULE_MACHINE_NAME_FSEIBAN_CACHE_TTL_MS = '60000';
  });

  afterEach(() => {
    delete process.env.PRODUCTION_SCHEDULE_MACHINE_NAME_FSEIBAN_CACHE_TTL_MS;
    resetMachineNameFseibanMatchCaches();
  });

  it('matches FSEIBAN from MH/SH schedule rows and supplement rows', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      { fseiban: 'FS-MH', fhinmei: 'L300KP' },
    ] as never);
    vi.mocked(prisma.productionScheduleSeibanMachineNameSupplement.findMany).mockResolvedValue([
      { fseiban: 'FS-SUP', machineName: 'L300KP' },
    ] as never);

    const fseibans = await resolveMatchingFseibansByNormalizedMachineName('L300KP');

    expect(fseibans.sort()).toEqual(['FS-MH', 'FS-SUP']);
  });

  it('matches every MH/SH machine-name candidate for the same FSEIBAN', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      { fseiban: 'FS-MULTI', fhinmei: 'ALPHA' },
      { fseiban: 'FS-MULTI', fhinmei: 'BETA' },
    ] as never);
    vi.mocked(prisma.productionScheduleSeibanMachineNameSupplement.findMany).mockResolvedValue([]);

    const fseibans = await resolveMatchingFseibansByNormalizedMachineName('BETA');

    expect(fseibans).toEqual(['FS-MULTI']);
  });

  it('reuses schedule/supplement indexes within TTL for different machine names', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      { fseiban: 'FS-A', fhinmei: 'ALPHA' },
      { fseiban: 'FS-B', fhinmei: 'BETA' },
    ] as never);
    vi.mocked(prisma.productionScheduleSeibanMachineNameSupplement.findMany).mockResolvedValue([]);

    await resolveMatchingFseibansByNormalizedMachineName('ALPHA');
    await resolveMatchingFseibansByNormalizedMachineName('BETA');

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.productionScheduleSeibanMachineNameSupplement.findMany).toHaveBeenCalledTimes(1);
  });

  it('reuses resolved machine-name result within TTL', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      { fseiban: 'FS-A', fhinmei: 'ALPHA' },
    ] as never);
    vi.mocked(prisma.productionScheduleSeibanMachineNameSupplement.findMany).mockResolvedValue([]);

    await resolveMatchingFseibansByNormalizedMachineName('ALPHA');
    await resolveMatchingFseibansByNormalizedMachineName('ALPHA');

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.productionScheduleSeibanMachineNameSupplement.findMany).toHaveBeenCalledTimes(1);
  });

  it('prunes expired machine-name result cache entries before resolving a new key', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-08T20:16:00+09:00'));
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      { fseiban: 'FS-A', fhinmei: 'ALPHA' },
      { fseiban: 'FS-B', fhinmei: 'BETA' },
    ] as never);
    vi.mocked(prisma.productionScheduleSeibanMachineNameSupplement.findMany).mockResolvedValue([]);

    await resolveMatchingFseibansByNormalizedMachineName('ALPHA');
    vi.setSystemTime(new Date('2026-06-08T20:17:01+09:00'));
    await resolveMatchingFseibansByNormalizedMachineName('BETA');
    await resolveMatchingFseibansByNormalizedMachineName('BETA');

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(prisma.productionScheduleSeibanMachineNameSupplement.findMany).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });
});
