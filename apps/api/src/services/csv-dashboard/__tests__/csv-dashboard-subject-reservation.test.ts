import { beforeEach, describe, expect, it, vi } from 'vitest';

const dashboardMock = vi.hoisted(() => ({
  create: vi.fn(),
  findFirst: vi.fn(),
  update: vi.fn(),
}));

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    csvDashboard: dashboardMock,
  },
}));

import { CsvDashboardService } from '../csv-dashboard.service.js';

describe('CsvDashboardService reserved Gmail subject', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects a conflicting legacy subject before create', async () => {
    const service = new CsvDashboardService();

    await expect(
      service.create({
        name: 'test',
        gmailSubjectPattern: 'ASM',
        columnDefinitions: [
          {
            internalName: 'value',
            displayName: '値',
            csvHeaderCandidates: ['値'],
            dataType: 'string',
            order: 0,
          },
        ],
        templateType: 'TABLE',
        templateConfig: {
          rowsPerPage: 10,
          fontSize: 14,
          displayColumns: ['value'],
        },
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'GMAIL_SUBJECT_PATTERN_RESERVED',
    });
    expect(dashboardMock.create).not.toHaveBeenCalled();
  });

  it('rejects a conflicting legacy subject before update', async () => {
    dashboardMock.findFirst.mockResolvedValueOnce({
      id: 'dashboard-1',
      configType: 'DASHBOARD',
      templateType: 'TABLE',
      gmailSubjectPattern: null,
    });
    const service = new CsvDashboardService();

    await expect(
      service.update('dashboard-1', { gmailSubjectPattern: 'DocumentASM' })
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'GMAIL_SUBJECT_PATTERN_RESERVED',
    });
    expect(dashboardMock.update).not.toHaveBeenCalled();
  });

  it('rejects another-field update when the stored legacy subject conflicts', async () => {
    dashboardMock.findFirst.mockResolvedValueOnce({
      id: 'dashboard-legacy',
      configType: 'DASHBOARD',
      templateType: 'TABLE',
      gmailSubjectPattern: 'ASM',
    });
    const service = new CsvDashboardService();

    await expect(
      service.update('dashboard-legacy', { name: 'updated name' })
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'GMAIL_SUBJECT_PATTERN_RESERVED',
    });
    expect(dashboardMock.update).not.toHaveBeenCalled();
  });
});
