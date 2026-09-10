import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildServer } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import {
  resolveSeibanCandidateDateRange,
  todayJstYmd
} from '../../services/production-schedule/grinding-planning-board-seiban-candidates.service.js';

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/borrow_return';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-1234567890';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-1234567890';

const DASHBOARD_ID = '3f2f6b0e-6a1e-4c0b-9d0b-1a4f3f0d2a01';
const CLIENT_KEY = 'candidate-test-client-key';

const toDate = (value: string): Date => new Date(`${value}T00:00:00.000Z`);

describe('Kiosk grinding planning board seiban candidates API', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeAll(async () => {
    app = await buildServer();
  });

  beforeEach(async () => {
    await prisma.productionScheduleSeibanDueDate.deleteMany({ where: { csvDashboardId: DASHBOARD_ID } });
    await prisma.productionScheduleProgress.deleteMany({ where: { csvDashboardId: DASHBOARD_ID } });
    await prisma.csvDashboardRow.deleteMany({ where: { csvDashboardId: DASHBOARD_ID } });
    await prisma.csvDashboard.deleteMany({ where: { id: DASHBOARD_ID } });

    await prisma.clientDevice.upsert({
      where: { apiKey: CLIENT_KEY },
      update: { name: 'Candidate Test', location: 'Test', defaultMode: 'TAG' },
      create: { apiKey: CLIENT_KEY, name: 'Candidate Test', location: 'Test', defaultMode: 'TAG' }
    });
    await prisma.csvDashboard.create({
      data: {
        id: DASHBOARD_ID,
        name: 'ProductionSchedule_Candidate_Test',
        columnDefinitions: [],
        templateType: 'CARD_GRID',
        templateConfig: {},
        ingestMode: 'DEDUP',
        dedupKeyColumns: ['ProductNo', 'FSEIBAN', 'FHINCD', 'FSIGENCD', 'FKOJUN'],
        dateColumnName: 'registeredAt',
        gmailSubjectPattern: 'candidate-test',
        enabled: true
      }
    });

    const today = todayJstYmd();
    const { rangeStart, rangeEnd } = resolveSeibanCandidateDateRange(today);
    await prisma.csvDashboardRow.createMany({
      data: [
        { csvDashboardId: DASHBOARD_ID, occurredAt: new Date(), dataHash: 'candidate-incomplete', rowData: { ProductNo: 'CAND-1', FSEIBAN: 'SEIBAN-INCOMPLETE', FHINCD: 'MH-01', FHINMEI: '機種A', FSIGENCD: '305', FKOJUN: '10' } },
        { csvDashboardId: DASHBOARD_ID, occurredAt: new Date(), dataHash: 'candidate-complete', rowData: { ProductNo: 'CAND-2', FSEIBAN: 'SEIBAN-COMPLETE', FHINCD: 'MH-02', FHINMEI: '機種B', FSIGENCD: '305', FKOJUN: '10' } },
        { csvDashboardId: DASHBOARD_ID, occurredAt: new Date(), dataHash: 'candidate-outside', rowData: { ProductNo: 'CAND-3', FSEIBAN: 'SEIBAN-OUTSIDE', FHINCD: 'MH-03', FHINMEI: '機種C', FSIGENCD: '305', FKOJUN: '10' } }
      ]
    });
    const rows = await prisma.csvDashboardRow.findMany({ where: { csvDashboardId: DASHBOARD_ID }, select: { id: true, rowData: true } });
    const completeRow = rows.find((row) => (row.rowData as { FSEIBAN?: string }).FSEIBAN === 'SEIBAN-COMPLETE');
    if (!completeRow) throw new Error('complete fixture row was not created');
    await prisma.productionScheduleProgress.create({ data: { csvDashboardRowId: completeRow.id, csvDashboardId: DASHBOARD_ID, isCompleted: true } });

    await prisma.productionScheduleSeibanDueDate.createMany({
      data: [
        { csvDashboardId: DASHBOARD_ID, fseiban: 'SEIBAN-INCOMPLETE', dueDate: toDate(rangeStart) },
        { csvDashboardId: DASHBOARD_ID, fseiban: 'SEIBAN-COMPLETE', dueDate: toDate(rangeEnd) },
        { csvDashboardId: DASHBOARD_ID, fseiban: 'SEIBAN-OUTSIDE', dueDate: new Date(toDate(rangeStart).getTime() - 86_400_000) }
      ]
    });
  });

  afterAll(async () => {
    await prisma.productionScheduleSeibanDueDate.deleteMany({ where: { csvDashboardId: DASHBOARD_ID } });
    await prisma.productionScheduleProgress.deleteMany({ where: { csvDashboardId: DASHBOARD_ID } });
    await prisma.csvDashboardRow.deleteMany({ where: { csvDashboardId: DASHBOARD_ID } });
    await prisma.csvDashboard.deleteMany({ where: { id: DASHBOARD_ID } });
    await app.close();
  });

  it('lists unregistered in-range seibans, excludes completed by default, and includes them with the toggle', async () => {
    const incompleteResponse = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule/grinding-planning-board/seiban-candidates?category=grinding',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(incompleteResponse.statusCode).toBe(200);
    const incomplete = incompleteResponse.json() as { candidates: Array<{ fseiban: string; machineName: string; dueDate: string }> };
    expect(incomplete.candidates).toEqual([
      expect.objectContaining({ fseiban: 'SEIBAN-INCOMPLETE', machineName: '機種A' })
    ]);

    const allResponse = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule/grinding-planning-board/seiban-candidates?category=grinding&completionFilter=all',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(allResponse.statusCode).toBe(200);
    const all = allResponse.json() as { candidates: Array<{ fseiban: string; isCompleted: boolean }> };
    expect(all.candidates.map((candidate) => candidate.fseiban)).toEqual(['SEIBAN-INCOMPLETE', 'SEIBAN-COMPLETE']);
    expect(all.candidates.find((candidate) => candidate.fseiban === 'SEIBAN-COMPLETE')?.isCompleted).toBe(true);
  });
});
