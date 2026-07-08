import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildServer } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../../services/production-schedule/constants.js';
import { createAuthHeader, createTestUser } from './helpers.js';

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/borrow_return';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-1234567890';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-1234567890';

describe('inspection drawing fhincd-candidates API', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let closeServer: (() => Promise<void>) | null = null;
  let viewerToken: string;

  beforeAll(async () => {
    app = await buildServer();
    closeServer = async () => {
      await app.close();
    };
  });

  beforeEach(async () => {
    await prisma.csvDashboardRow.deleteMany({
      where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID }
    });
    await prisma.csvDashboard.upsert({
      where: { id: PRODUCTION_SCHEDULE_DASHBOARD_ID },
      update: {},
      create: {
        id: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        name: 'ProductionSchedule_Test',
        columnDefinitions: [],
        templateType: 'CARD_GRID',
        templateConfig: {},
        ingestMode: 'DEDUP',
        dedupKeyColumns: ['ProductNo'],
        dateColumnName: 'registeredAt',
        enabled: true
      }
    });
    const viewer = await createTestUser('VIEWER');
    viewerToken = viewer.token;
  });

  afterAll(async () => {
    if (closeServer) {
      await closeServer();
    }
  });

  it('returns empty array when prefix is shorter than 2 characters', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/part-measurement/inspection-drawing/fhincd-candidates?prefix=A',
      headers: createAuthHeader(viewerToken)
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().candidates).toEqual([]);
  });

  it('returns distinct fhincd candidates with representative fhinmei', async () => {
    const prefix = `AB${Date.now().toString().slice(-4)}`;
    await prisma.csvDashboardRow.createMany({
      data: [
        {
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          occurredAt: new Date(),
          dataHash: `fhincd-cand-1-${Date.now()}`,
          rowData: { FHINCD: `${prefix}01`, FHINMEI: '品名A' }
        },
        {
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          occurredAt: new Date(),
          dataHash: `fhincd-cand-2-${Date.now()}`,
          rowData: { FHINCD: `${prefix}02`, FHINMEI: '品名B' }
        },
        {
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          occurredAt: new Date(),
          dataHash: `fhincd-cand-3-${Date.now()}`,
          rowData: { FHINCD: `${prefix}01`, FHINMEI: '品名A別表記' }
        }
      ]
    });

    const response = await app.inject({
      method: 'GET',
      url: `/api/part-measurement/inspection-drawing/fhincd-candidates?prefix=${encodeURIComponent(prefix)}&limit=10`,
      headers: createAuthHeader(viewerToken)
    });
    expect(response.statusCode).toBe(200);
    const candidates = response.json().candidates as Array<{ fhincd: string; fhinmei: string | null }>;
    expect(candidates.map((row) => row.fhincd).sort()).toEqual([`${prefix}01`, `${prefix}02`]);
    expect(candidates.find((row) => row.fhincd === `${prefix}01`)?.fhinmei).toBeTruthy();
  });
});
