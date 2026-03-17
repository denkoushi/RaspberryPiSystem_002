import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildServer } from '../../app.js';
import { prisma } from '../../lib/prisma.js';

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/borrow_return';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-1234567890';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-1234567890';

const DASHBOARD_ID = '3f2f6b0e-6a1e-4c0b-9d0b-1a4f3f0d2a01';
const CLIENT_KEY = 'client-demo-key';

describe('Kiosk Production Schedule Order Search API', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeAll(async () => {
    app = await buildServer();
  });

  afterAll(async () => {
    await prisma.productionScheduleProgress.deleteMany({ where: { csvDashboardId: DASHBOARD_ID } });
    await prisma.csvDashboardRow.deleteMany({ where: { csvDashboardId: DASHBOARD_ID } });
    await prisma.csvDashboard.deleteMany({ where: { id: DASHBOARD_ID } });
    await app.close();
  });

  beforeEach(async () => {
    await prisma.productionScheduleProgress.deleteMany({ where: { csvDashboardId: DASHBOARD_ID } });
    await prisma.csvDashboardRow.deleteMany({ where: { csvDashboardId: DASHBOARD_ID } });
    await prisma.csvDashboard.deleteMany({ where: { id: DASHBOARD_ID } });

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
          dataHash: 'order-10000',
          rowData: {
            ProductNo: '1234500001',
            FSEIBAN: 'SEI-A',
            FHINCD: 'PA-01',
            FHINMEI: '部品A',
            FSIGENCD: '305',
            FKOJUN: '10',
            progress: ''
          }
        },
        {
          csvDashboardId: DASHBOARD_ID,
          occurredAt: new Date(),
          dataHash: 'order-10001',
          rowData: {
            ProductNo: '1234500002',
            FSEIBAN: 'SEI-A',
            FHINCD: 'PA-02',
            FHINMEI: '部品A',
            FSIGENCD: '305',
            FKOJUN: '20',
            progress: ''
          }
        },
        {
          csvDashboardId: DASHBOARD_ID,
          occurredAt: new Date(),
          dataHash: 'order-10002',
          rowData: {
            ProductNo: '1234560003',
            FSEIBAN: 'SEI-B',
            FHINCD: 'PB-01',
            FHINMEI: '部品B',
            FSIGENCD: '305',
            FKOJUN: '10',
            progress: ''
          }
        }
      ]
    });
  });

  it('5桁入力で部品名候補を返し、部品未選択時はordersを返さない', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule/order-search?resourceCds=305&resourceCategory=grinding&productNoPrefix=12345',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { partNameOptions: string[]; orders: string[] };
    expect(body.partNameOptions).toEqual(['部品A', '部品B']);
    expect(body.orders).toEqual([]);
  });

  it('部品名指定時のみ該当の製造order番号を返す', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule/order-search?resourceCds=305&resourceCategory=grinding&productNoPrefix=12345&partName=%E9%83%A8%E5%93%81A',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { partNameOptions: string[]; orders: string[] };
    expect(body.partNameOptions).toEqual(['部品A']);
    expect(body.orders).toEqual(['1234500001', '1234500002']);
  });

  it('6桁入力で候補が自動で絞り込まれる', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule/order-search?resourceCds=305&resourceCategory=grinding&productNoPrefix=123456&partName=%E9%83%A8%E5%93%81B',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { partNameOptions: string[]; orders: string[] };
    expect(body.partNameOptions).toEqual(['部品B']);
    expect(body.orders).toEqual(['1234560003']);
  });

  it('5桁未満のprefixはバリデーションエラーにする', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/kiosk/production-schedule/order-search?resourceCds=305&resourceCategory=grinding&productNoPrefix=1234',
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(res.statusCode).toBe(400);
  });
});
