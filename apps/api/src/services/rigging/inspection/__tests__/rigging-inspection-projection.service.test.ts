import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../lib/prisma.js', () => ({
  prisma: {
    riggingGear: { findUnique: vi.fn(), findFirst: vi.fn() },
    employee: { findMany: vi.fn() },
    riggingInspectionRecord: {
      findFirst: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
  },
}));

import { prisma } from '../../../../lib/prisma.js';
import { RiggingInspectionProjectionService } from '../rigging-inspection-projection.service.js';

describe('RiggingInspectionProjectionService', () => {
  let service: RiggingInspectionProjectionService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new RiggingInspectionProjectionService();
  });

  it('refreshes inspectedAt when a newer row matches the same business-day dedup key', async () => {
    const olderAt = new Date('2026-05-21T02:22:52.000Z');
    const newerAt = new Date('2026-05-21T23:25:25.000Z');

    vi.spyOn(service as never, 'syncFromPersistedDashboardRows').mockRestore();
    vi.mocked(prisma.riggingGear.findUnique).mockResolvedValue({
      id: 'gear-1',
      managementNumber: 'M02G',
    } as never);
    vi.mocked(prisma.employee.findMany).mockResolvedValue([
      { id: 'emp-1', displayName: '矢田 彗遥', status: 'ACTIVE' },
    ] as never);
    vi.mocked(prisma.riggingInspectionRecord.findFirst).mockResolvedValue({
      id: 'rec-1',
      inspectedAt: olderAt,
    } as never);
    vi.mocked(prisma.riggingInspectionRecord.update).mockResolvedValue({} as never);

    const result = await (service as unknown as {
      projectOrderedRows: (
        rows: Array<{ rowData: Record<string, unknown> }>,
        context: Record<string, never>,
      ) => Promise<{ created: number; refreshed: number; deduped: number }>;
    }).projectOrderedRows(
      [
        {
          rowData: {
            managementNumber: 'M02G',
            inspectorName: '矢田彗遥',
            result: '正常',
            inspectedAt: newerAt.toISOString(),
          },
        },
      ],
      {},
    );

    expect(result.created).toBe(0);
    expect(result.refreshed).toBe(1);
    expect(result.deduped).toBe(0);
    expect(prisma.riggingInspectionRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'rec-1' },
        data: expect.objectContaining({ inspectedAt: newerAt }),
      }),
    );
  });

  it('dedupes when an existing record is newer than the incoming row', async () => {
    const incomingAt = new Date('2026-05-21T02:22:52.000Z');
    const existingAt = new Date('2026-05-21T23:25:25.000Z');

    vi.mocked(prisma.riggingGear.findUnique).mockResolvedValue({
      id: 'gear-1',
      managementNumber: 'M02G',
    } as never);
    vi.mocked(prisma.employee.findMany).mockResolvedValue([
      { id: 'emp-1', displayName: '矢田 彗遥', status: 'ACTIVE' },
    ] as never);
    vi.mocked(prisma.riggingInspectionRecord.findFirst).mockResolvedValue({
      id: 'rec-1',
      inspectedAt: existingAt,
    } as never);

    const result = await (service as unknown as {
      projectOrderedRows: (
        rows: Array<{ rowData: Record<string, unknown> }>,
        context: Record<string, never>,
      ) => Promise<{ created: number; refreshed: number; deduped: number }>;
    }).projectOrderedRows(
      [
        {
          rowData: {
            managementNumber: 'M02G',
            inspectorName: '矢田彗遥',
            result: '正常',
            inspectedAt: incomingAt.toISOString(),
          },
        },
      ],
      {},
    );

    expect(result.created).toBe(0);
    expect(result.refreshed).toBe(0);
    expect(result.deduped).toBe(1);
    expect(prisma.riggingInspectionRecord.update).not.toHaveBeenCalled();
  });
});
