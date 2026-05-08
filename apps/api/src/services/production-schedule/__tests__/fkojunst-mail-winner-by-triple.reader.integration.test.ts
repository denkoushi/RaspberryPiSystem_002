import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import { findFkojunstMailWinnerIdsByMailTriples } from '../fkojunst-mail-winner-by-triple.reader.js';
import { buildFkojunstMailStatusKey } from '../fkojunst-mail-status-key.js';

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/borrow_return';

async function resetProductionScheduleDashboard() {
  await prisma.csvDashboardRow.deleteMany({
    where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID },
  });
  await prisma.csvDashboard.deleteMany({
    where: { id: PRODUCTION_SCHEDULE_DASHBOARD_ID },
  });
  await prisma.csvDashboard.create({
    data: {
      id: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      name: 'ProductionSchedule_Test',
      ingestMode: 'APPEND',
      columnDefinitions: [
        { internalName: 'FSEIBAN', displayName: '製番', dataType: 'string', order: 0 },
        { internalName: 'FHINCD', displayName: '品番', dataType: 'string', order: 1 },
        { internalName: 'FSIGENCD', displayName: '資源CD', dataType: 'string', order: 2 },
        { internalName: 'FKOJUN', displayName: '工順', dataType: 'string', order: 3 },
        { internalName: 'ProductNo', displayName: 'ProductNo', dataType: 'string', order: 4 },
      ],
      templateType: 'TABLE',
      templateConfig: {
        rowsPerPage: 10,
        fontSize: 14,
        displayColumns: ['FSEIBAN', 'FHINCD', 'FSIGENCD', 'FKOJUN', 'ProductNo'],
      },
    },
  });
}

describe('findFkojunstMailWinnerIdsByMailTriples integration', () => {
  beforeEach(async () => {
    await resetProductionScheduleDashboard();
  });

  afterAll(async () => {
    await prisma.csvDashboardRow.deleteMany({
      where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID },
    });
    await prisma.csvDashboard.deleteMany({
      where: { id: PRODUCTION_SCHEDULE_DASHBOARD_ID },
    });
    await prisma.$disconnect();
  });

  it('resolves winner rows with tuple-chunk queries on real PostgreSQL', async () => {
    await prisma.csvDashboardRow.createMany({
      data: [
        {
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          occurredAt: new Date('2026-05-08T00:00:00Z'),
          createdAt: new Date('2026-05-08T00:00:00Z'),
          rowData: {
            FSEIBAN: 'S-1',
            FHINCD: 'H-1',
            FSIGENCD: 'R1',
            FKOJUN: '10',
            ProductNo: '1',
          },
        },
        {
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          occurredAt: new Date('2026-05-08T00:00:00Z'),
          createdAt: new Date('2026-05-08T00:00:01Z'),
          rowData: {
            FSEIBAN: 'S-1',
            FHINCD: 'H-1',
            FSIGENCD: 'R1',
            FKOJUN: '10',
            ProductNo: '2',
          },
        },
        {
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          occurredAt: new Date('2026-05-08T00:00:00Z'),
          createdAt: new Date('2026-05-08T00:00:02Z'),
          rowData: {
            FSEIBAN: 'S-2',
            FHINCD: 'H-2',
            FSIGENCD: 'R2',
            FKOJUN: '20',
            ProductNo: '5',
          },
        },
      ],
    });

    const rows = await prisma.csvDashboardRow.findMany({
      where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID },
      orderBy: { createdAt: 'asc' },
    });
    const winnerA = rows.find((row) => (row.rowData as Record<string, string>).ProductNo === '2');
    const winnerB = rows.find((row) => (row.rowData as Record<string, string>).ProductNo === '5');

    const result = await findFkojunstMailWinnerIdsByMailTriples({
      client: prisma,
      productionScheduleDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      triples: [
        { fkojun: '10', fkoteicd: 'r1', fsezono: '2' },
        { fkojun: '20', fkoteicd: 'R2', fsezono: '5' },
        { fkojun: '10', fkoteicd: 'R1', fsezono: '1' },
      ],
      chunkSize: 1,
    });

    expect(result.get(buildFkojunstMailStatusKey({ fkojun: '10', fkoteicd: 'R1', fsezono: '2' }))).toBe(
      winnerA?.id
    );
    expect(result.get(buildFkojunstMailStatusKey({ fkojun: '20', fkoteicd: 'R2', fsezono: '5' }))).toBe(
      winnerB?.id
    );
    expect(result.has(buildFkojunstMailStatusKey({ fkojun: '10', fkoteicd: 'R1', fsezono: '1' }))).toBe(false);
  });
});
