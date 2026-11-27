import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

const findMany = vi.hoisted(() => vi.fn());
const findFirst = vi.hoisted(() => vi.fn());
vi.mock('../../../../lib/prisma.js', () => ({ prisma: { productionScheduleDScheduleMinutes: { findMany }, productionScheduleDScheduleMinutesImportRun: { findFirst } } }));

import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../../../../services/production-schedule/constants.js';
import { registerProductionScheduleDScheduleMinutesRoute } from '../d-schedule-minutes.js';
import type { KioskRouteDeps } from '../shared.js';

const url = '/kiosk/production-schedule/d-schedule-minutes';
afterEach(() => vi.clearAllMocks());

describe('D schedule minutes kiosk read', () => {
  it('authenticates and returns latest dashboard rows without import internals or labels', async () => {
    const app = Fastify();
    const requireClientDevice = vi.fn().mockResolvedValue({ clientDevice: { id: 'device' } });
    await registerProductionScheduleDScheduleMinutesRoute(app, { requireClientDevice } as unknown as KioskRouteDeps);
    const row = { fseiban: 'BA123456', outsourceMarks: ['Y', 'Z'], surfaceSendOutDates: [{ date: '2026-11-10', label: '★LSLH処理出', note: 'CT以外' }], memo: '協力会社' };
    findMany.mockResolvedValue([row]);
    findFirst.mockImplementation(async ({ where }: { where: { kind: string } }) => where.kind === 'D_COMPANY' ? { receivedAt: new Date('2026-11-25T23:42:00Z') } : null);
    try {
      const response = await app.inject({ url: `${url}?csvDashboardId=foreign`, headers: { 'x-client-key': 'key' } });
      expect(response.statusCode).toBe(200);
      expect(requireClientDevice).toHaveBeenCalledExactlyOnceWith('key');
      expect(findMany).toHaveBeenCalledExactlyOnceWith({
        where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID }, orderBy: { fseiban: 'asc' },
        select: { fseiban: true, outsourceMarks: true, surfaceSendOutDates: true, memo: true }
      });
      for (const kind of ['D_COMPANY', 'INTERNAL']) expect(findFirst).toHaveBeenCalledWith({ where: { kind, status: { in: ['APPLIED', 'SUCCESS'] } }, orderBy: [{ meetingDate: 'desc' }, { receivedAt: 'desc' }], select: { receivedAt: true } });
      expect(response.json()).toEqual({ latestReceivedAt: { D_COMPANY: '2026-11-25T23:42:00.000Z', INTERNAL: null }, rows: [{ ...row, surfaceSendOutDates: [{ date: '2026-11-10', note: 'CT以外' }] }] });
      expect(response.headers['cache-control']).toBe('no-store');
    } finally { await app.close(); }
  });

  it('returns an empty collection before the first import', async () => {
    const app = Fastify();
    await registerProductionScheduleDScheduleMinutesRoute(app, { requireClientDevice: vi.fn().mockResolvedValue({}) } as unknown as KioskRouteDeps);
    findMany.mockResolvedValue([]);
    findFirst.mockResolvedValue(null);
    try { expect((await app.inject({ url })).json()).toEqual({ latestReceivedAt: { D_COMPANY: null, INTERNAL: null }, rows: [] }); }
    finally { await app.close(); }
  });

  it('does not query the database when device authentication fails', async () => {
    const app = Fastify();
    await registerProductionScheduleDScheduleMinutesRoute(app, { requireClientDevice: vi.fn().mockRejectedValue(Object.assign(new Error('Unauthorized'), { statusCode: 401 })) } as unknown as KioskRouteDeps);
    try {
      expect((await app.inject({ url })).statusCode).toBe(401);
      expect(findMany).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
});
