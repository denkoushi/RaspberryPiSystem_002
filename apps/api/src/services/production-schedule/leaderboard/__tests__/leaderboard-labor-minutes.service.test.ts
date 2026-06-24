import { Prisma } from '@prisma/client';
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../../../lib/prisma.js', () => ({
  prisma: {
    $queryRaw: vi.fn()
  }
}));

import { prisma } from '../../../../lib/prisma.js';
import {
  attachLeaderboardLaborMinutes,
  attachLeaderboardMachineOnlyMinutes,
  clearLeaderboardLaborMinutesLookupCacheForTests
} from '../leaderboard-labor-minutes.service.js';

import type { ProductionScheduleRow } from '../../production-schedule-query.service.js';

const lookupContext = {
  leaderboardMaterializedBaseWhere: Prisma.sql`TRUE`,
  processChangeResidualMode: 'include' as const
};

function mkRow(
  partial: Partial<ProductionScheduleRow> & {
    rowData: Record<string, unknown>;
  }
): ProductionScheduleRow {
  return {
    id: partial.id ?? 'row-1',
    occurredAt: partial.occurredAt ?? '2026-01-01T00:00:00.000Z',
    rowData: partial.rowData,
    processingOrder: partial.processingOrder ?? null,
    dueDate: partial.dueDate ?? null,
    plannedEndDate: partial.plannedEndDate ?? null,
    machineRequiredMinutes: partial.machineRequiredMinutes,
    laborRequiredMinutes: partial.laborRequiredMinutes
  };
}

describe('attachLeaderboardLaborMinutes', () => {
  beforeEach(() => {
    vi.mocked(prisma.$queryRaw).mockReset();
    clearLeaderboardLaborMinutesLookupCacheForTests();
  });

  it('returns empty array without querying when input is empty', async () => {
    await expect(attachLeaderboardLaborMinutes([], lookupContext)).resolves.toEqual([]);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('skips DB lookup when all rows already carry labor metadata', async () => {
    const rows = [
      mkRow({
        id: 'r1',
        rowData: { FSIGENCD: '021', ProductNo: 'P1', FKOJUN: '10', FSIGENSHOYORYO: '400' },
        machineRequiredMinutes: 400,
        laborRequiredMinutes: 175
      })
    ];

    const out = await attachLeaderboardLaborMinutes(rows, lookupContext);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(out[0]?.machineRequiredMinutes).toBe(400);
    expect(out[0]?.laborRequiredMinutes).toBe(175);
  });

  it('attaches machine and labor minutes from lookup for machine rows', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([
      { productNo: '0003767716', fkojun: '210', laborMinutes: 175 }
    ] as never);

    const rows = [
      mkRow({
        id: 'machine-1',
        rowData: {
          FSIGENCD: '021',
          ProductNo: '0003767716',
          FKOJUN: '210',
          FSIGENSHOYORYO: '400'
        }
      })
    ];

    const out = await attachLeaderboardLaborMinutes(rows, lookupContext);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(out[0]?.machineRequiredMinutes).toBe(400);
    expect(out[0]?.laborRequiredMinutes).toBe(175);
  });

  it('maps FSIGENCD=10 rows to labor-only metadata', async () => {
    const rows = [
      mkRow({
        id: 'labor-row',
        rowData: {
          FSIGENCD: '10',
          ProductNo: '0003767716',
          FKOJUN: '210',
          FSIGENSHOYORYO: '175'
        }
      })
    ];

    const out = await attachLeaderboardLaborMinutes(rows, lookupContext);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(out[0]?.machineRequiredMinutes).toBe(0);
    expect(out[0]?.laborRequiredMinutes).toBe(175);
  });

  it('treats non-positive FSIGENSHOYORYO as zero machine minutes', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([] as never);

    const rows = [
      mkRow({
        id: 'neg',
        rowData: {
          FSIGENCD: '021',
          ProductNo: 'PNEG',
          FKOJUN: '210',
          FSIGENSHOYORYO: '-5'
        }
      })
    ];

    const out = await attachLeaderboardLaborMinutes(rows, lookupContext);
    expect(out[0]?.machineRequiredMinutes).toBe(0);
    expect(out[0]?.laborRequiredMinutes).toBe(0);
  });

  it('falls back to zero labor when ProductNo or FKOJUN is missing', async () => {
    const rows = [
      mkRow({
        id: 'missing-key',
        rowData: {
          FSIGENCD: '021',
          ProductNo: '',
          FKOJUN: '210',
          FSIGENSHOYORYO: '120'
        }
      })
    ];

    const out = await attachLeaderboardLaborMinutes(rows, lookupContext);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(out[0]?.machineRequiredMinutes).toBe(120);
    expect(out[0]?.laborRequiredMinutes).toBe(0);
  });

  it('issues a single lookup for duplicate ProductNo+FKOJUN keys', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([
      { productNo: 'P1', fkojun: '10', laborMinutes: 30 }
    ] as never);

    const rows = [
      mkRow({
        id: 'a',
        rowData: { FSIGENCD: '021', ProductNo: 'P1', FKOJUN: '10', FSIGENSHOYORYO: '100' }
      }),
      mkRow({
        id: 'b',
        rowData: { FSIGENCD: '305', ProductNo: 'P1', FKOJUN: '10', FSIGENSHOYORYO: '200' }
      })
    ];

    const out = await attachLeaderboardLaborMinutes(rows, lookupContext);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(out.map((r) => r.laborRequiredMinutes)).toEqual([30, 30]);
  });

  it('reuses cached labor minutes within the same generation scope', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([
      { productNo: 'P1', fkojun: '10', laborMinutes: 30 }
    ] as never);

    const scopedContext = {
      ...lookupContext,
      cacheScopeKey: 'generation-1'
    };
    const row = mkRow({
      id: 'a',
      rowData: { FSIGENCD: '021', ProductNo: 'P1', FKOJUN: '10', FSIGENSHOYORYO: '100' }
    });

    const first = await attachLeaderboardLaborMinutes([row], scopedContext);
    const second = await attachLeaderboardLaborMinutes([{ ...row, id: 'b' }], scopedContext);

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(first[0]?.laborRequiredMinutes).toBe(30);
    expect(second[0]?.laborRequiredMinutes).toBe(30);
  });

  it('does not reuse cached labor minutes across generation scopes', async () => {
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([{ productNo: 'P1', fkojun: '10', laborMinutes: 30 }] as never)
      .mockResolvedValueOnce([{ productNo: 'P1', fkojun: '10', laborMinutes: 40 }] as never);

    const row = mkRow({
      id: 'a',
      rowData: { FSIGENCD: '021', ProductNo: 'P1', FKOJUN: '10', FSIGENSHOYORYO: '100' }
    });

    const first = await attachLeaderboardLaborMinutes([row], {
      ...lookupContext,
      cacheScopeKey: 'generation-1'
    });
    const second = await attachLeaderboardLaborMinutes([{ ...row, id: 'b' }], {
      ...lookupContext,
      cacheScopeKey: 'generation-2'
    });

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(first[0]?.laborRequiredMinutes).toBe(30);
    expect(second[0]?.laborRequiredMinutes).toBe(40);
  });
});

describe('attachLeaderboardMachineOnlyMinutes', () => {
  beforeEach(() => {
    vi.mocked(prisma.$queryRaw).mockReset();
  });

  it('attaches machine minutes and zero labor without DB lookup', () => {
    const rows = [
      mkRow({
        id: 'machine-1',
        rowData: {
          FSIGENCD: '021',
          ProductNo: 'P1',
          FKOJUN: '10',
          FSIGENSHOYORYO: '400'
        }
      })
    ];

    const out = attachLeaderboardMachineOnlyMinutes(rows);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(out[0]?.machineRequiredMinutes).toBe(400);
    expect(out[0]?.laborRequiredMinutes).toBe(0);
  });
});
