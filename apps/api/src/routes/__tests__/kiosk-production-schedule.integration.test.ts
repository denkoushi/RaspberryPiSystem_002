import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../../app.js';
import { prisma } from '../../lib/prisma.js';

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/borrow_return';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-1234567890';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-1234567890';

const DASHBOARD_ID = '3f2f6b0e-6a1e-4c0b-9d0b-1a4f3f0d2a01';
const CLIENT_KEY = 'client-demo-key';

describe('Kiosk Production Schedule API', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let closeServer: (() => Promise<void>) | null = null;

  beforeAll(async () => {
    app = await buildServer();
    closeServer = async () => {
      await app.close();
    };
  });

  afterAll(async () => {
    await prisma.csvDashboardRow.deleteMany({ where: { csvDashboardId: DASHBOARD_ID } });
    await prisma.csvDashboard.deleteMany({ where: { id: DASHBOARD_ID } });
    if (closeServer) await closeServer();
  });

  beforeEach(async () => {
    await prisma.csvDashboardRow.deleteMany({ where: { csvDashboardId: DASHBOARD_ID } });
    await prisma.csvDashboard.deleteMany({ where: { id: DASHBOARD_ID } });

    // client-demo-key は seed.ts で作られるが、テスト単体でも通るように保険で作成
    await prisma.clientDevice.upsert({
      where: { apiKey: CLIENT_KEY },
      update: { name: 'Test Client', location: 'Test', defaultMode: 'TAG' },
      create: { apiKey: CLIENT_KEY, name: 'Test Client', location: 'Test', defaultMode: 'TAG' }
    });

    await prisma.csvDashboard.create({
      data: {
        id: DASHBOARD_ID,
        name: 'ProductionSchedule_Mishima_Grinding',
        columnDefinitions: [
          { internalName: 'ProductNo', displayName: 'ProductNo', csvHeaderCandidates: ['ProductNo'], dataType: 'string', order: 0 }
        ],
        templateType: 'CARD_GRID',
        templateConfig: { cardsPerPage: 9, fontSize: 14, displayFields: ['ProductNo'] },
        ingestMode: 'DEDUP',
        dedupKeyColumns: ['ProductNo', 'FSEIBAN', 'FHINCD', 'FSIGENCD', 'FKOJUN'],
        dateColumnName: 'registeredAt',
        gmailSubjectPattern: '生産日程_三島_研削工程',
        enabled: true
      }
    });

    await prisma.csvDashboardRow.createMany({
      data: [
        {
          csvDashboardId: DASHBOARD_ID,
          occurredAt: new Date(),
          dataHash: 'hash-1',
          rowData: { ProductNo: '0001', FSEIBAN: 'A', FHINCD: 'X', FSIGENCD: '1', FKOJUN: '210', progress: '' }
        },
        {
          csvDashboardId: DASHBOARD_ID,
          occurredAt: new Date(),
          dataHash: 'hash-2',
          rowData: { ProductNo: '0002', FSEIBAN: 'B', FHINCD: 'Y', FSIGENCD: '2', FKOJUN: '220', progress: '完了' }
        }
      ]
    });
  });

  it('rejects request without x-client-key', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/kiosk/production-schedule' });
    expect(res.statusCode).toBe(401);
  });

  it('lists all rows including completed ones (for graying out)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { rows: Array<{ rowData: { ProductNo?: string; progress?: string } }> };
    // 完了状態のものも含めて全て返す（グレーアウト表示のため）
    expect(body.rows.map((r) => r.rowData.ProductNo)).toEqual(['0001', '0002']);
    // 完了状態のものはprogressが'完了'
    const completedRow = body.rows.find((r) => r.rowData.ProductNo === '0002');
    expect(completedRow?.rowData.progress).toBe('完了');
  });

  it('completes a row and keeps it in list (grayed out)', async () => {
    const list = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    const first = (list.json() as any).rows.find((r: any) => r.rowData.ProductNo === '0001');
    expect(first).toBeDefined();
    expect(first.rowData.progress).toBe('');

    const complete = await app.inject({
      method: 'PUT',
      url: `/api/kiosk/production-schedule/${first.id}/complete`,
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(complete.statusCode).toBe(200);

    const after = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    // 完了状態のものも含めて全て返す（グレーアウト表示のため）
    expect((after.json() as any).rows).toHaveLength(2);
    const completedRow = (after.json() as any).rows.find((r: any) => r.id === first.id);
    expect(completedRow.rowData.progress).toBe('完了');
  });
});

