import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getProductionScheduleOrderUsage,
  listProductionScheduleResources,
  listProductionScheduleRows,
} from '../production-schedule-query.service.js';
import { prisma } from '../../../lib/prisma.js';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    $queryRaw: vi.fn(),
  },
}));

describe('production-schedule-query.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('資源CD単独指定時（assignedOnlyなし）は空結果を返しDBクエリしない', async () => {
    const result = await listProductionScheduleRows({
      page: 1,
      pageSize: 20,
      queryText: '',
      resourceCds: ['R01'],
      assignedOnlyCds: [],
      hasNoteOnly: false,
      hasDueDateOnly: false,
      locationKey: 'kiosk-1',
    });

    expect(result).toEqual({
      page: 1,
      pageSize: 20,
      total: 0,
      rows: [],
    });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('資源CD一覧をresourceCd配列へ整形して返す', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      { resourceCd: 'R01' },
      { resourceCd: 'R02' },
    ] as never);

    const result = await listProductionScheduleResources();

    expect(result).toEqual(['R01', 'R02']);
  });

  it('工程順利用状況をresourceCdごとのMap形式へ整形する', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      { resourceCd: 'R01', orderNumbers: [1, 3] },
      { resourceCd: 'R02', orderNumbers: [2] },
    ] as never);

    const result = await getProductionScheduleOrderUsage({
      locationKey: 'kiosk-1',
      resourceCds: ['R01', 'R02'],
    });

    expect(result).toEqual({
      R01: [1, 3],
      R02: [2],
    });
  });
});

