import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import { fetchSeibanProgressRows } from '../seiban-progress.service.js';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    $queryRaw: vi.fn(),
    productionScheduleSeibanMachineNameSupplement: { findMany: vi.fn() },
  },
}));

describe('seiban-progress.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fseiban が空なら DB クエリせず空配列を返す', async () => {
    const result = await fetchSeibanProgressRows([]);

    expect(result).toEqual([]);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('fseiban を正規化して進捗行を返す', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      { fseiban: 'S-001', total: 2, completed: 1, incompleteProductNames: ['A'], machineName: 'mha' },
    ] as never);

    const result = await fetchSeibanProgressRows(['S-001', ' S-001 ', '', 'S-002']);

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(result).toEqual([
      { fseiban: 'S-001', total: 2, completed: 1, incompleteProductNames: ['A'], machineName: 'mha' },
    ]);
    expect(prisma.productionScheduleSeibanMachineNameSupplement.findMany).not.toHaveBeenCalled();
  });

  it('MH/SH 行に機種名が無い製番だけ補完テーブルで機種名を埋める', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      { fseiban: 'S-001', total: 2, completed: 1, incompleteProductNames: ['A'], machineName: 'mha' },
      { fseiban: 'S-002', total: 1, completed: 0, incompleteProductNames: ['B'], machineName: null },
      { fseiban: 'S-003', total: 1, completed: 0, incompleteProductNames: ['C'], machineName: null },
    ] as never);
    vi.mocked(prisma.productionScheduleSeibanMachineNameSupplement.findMany).mockResolvedValue([
      { fseiban: 'S-002', machineName: '補完機種' },
    ] as never);

    const result = await fetchSeibanProgressRows(['S-001', 'S-002', 'S-003']);

    expect(prisma.productionScheduleSeibanMachineNameSupplement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ fseiban: { in: ['S-002', 'S-003'] } }),
      })
    );
    expect(result.map((row) => [row.fseiban, row.machineName])).toEqual([
      ['S-001', 'mha'],
      ['S-002', '補完機種'],
      ['S-003', null],
    ]);
  });

  it('supplementMachineName: false なら補完テーブルを見ずに MH/SH 行の機種名だけを返す', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      { fseiban: 'S-002', total: 1, completed: 0, incompleteProductNames: ['B'], machineName: null },
    ] as never);

    const result = await fetchSeibanProgressRows(['S-002'], undefined, { supplementMachineName: false });

    expect(result.map((row) => row.machineName)).toEqual([null]);
    expect(prisma.productionScheduleSeibanMachineNameSupplement.findMany).not.toHaveBeenCalled();
  });
});
