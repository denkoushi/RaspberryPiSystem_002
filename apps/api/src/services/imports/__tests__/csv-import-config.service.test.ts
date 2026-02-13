import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../lib/errors.js';
import { CsvImportConfigService } from '../csv-import-config.service.js';
import { prisma } from '../../../lib/prisma.js';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    csvDashboard: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

describe('CsvImportConfigService', () => {
  let service: CsvImportConfigService;

  const validColumns = [
    {
      internalName: 'employeeCode',
      displayName: '社員番号',
      csvHeaderCandidates: ['社員番号'],
      dataType: 'string' as const,
      order: 0,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    service = new CsvImportConfigService();
  });

  it('get returns null when config is not MASTER', async () => {
    vi.mocked(prisma.csvDashboard.findUnique).mockResolvedValue({
      id: 'master-config-employees',
      configType: 'DASHBOARD',
    } as any);

    const result = await service.get('employees');

    expect(result).toBeNull();
  });

  it('upsert validates column definitions and throws on empty list', async () => {
    await expect(
      service.upsert('employees', {
        enabled: true,
        allowedManualImport: true,
        allowedScheduledImport: true,
        importStrategy: 'UPSERT',
        columnDefinitions: [],
      })
    ).rejects.toThrow(ApiError);
  });

  it('upsert writes master config and returns normalized result', async () => {
    vi.mocked(prisma.csvDashboard.upsert).mockResolvedValue({
      id: 'master-config-employees',
      importType: 'employees',
      enabled: true,
      allowedManualImport: true,
      allowedScheduledImport: true,
      importStrategy: 'UPSERT',
      columnDefinitions: validColumns,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    } as any);

    const result = await service.upsert('employees', {
      enabled: true,
      allowedManualImport: true,
      allowedScheduledImport: true,
      importStrategy: 'UPSERT',
      columnDefinitions: validColumns,
    });

    expect(prisma.csvDashboard.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'master-config-employees' },
        update: expect.objectContaining({
          templateType: 'TABLE',
          templateConfig: expect.objectContaining({
            rowsPerPage: 1,
            fontSize: 14,
            displayColumns: ['employeeCode'],
            headerFixed: true,
          }),
        }),
      })
    );
    expect(result).toEqual(
      expect.objectContaining({
        id: 'master-config-employees',
        importType: 'employees',
        enabled: true,
      })
    );
  });
});
