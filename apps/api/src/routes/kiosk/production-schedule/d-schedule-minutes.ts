import type { FastifyInstance } from 'fastify';

import { prisma } from '../../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../../../services/production-schedule/constants.js';
import type { KioskRouteDeps } from './shared.js';

export async function registerProductionScheduleDScheduleMinutesRoute(app: FastifyInstance, deps: KioskRouteDeps): Promise<void> {
  app.get('/kiosk/production-schedule/d-schedule-minutes', { config: { rateLimit: false } }, async (request, reply) => {
    await deps.requireClientDevice(request.headers['x-client-key']);
    const rows = await prisma.productionScheduleDScheduleMinutes.findMany({
      where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID },
      orderBy: { fseiban: 'asc' },
      select: { fseiban: true, outsourceMarks: true, surfaceSendOutDates: true, memo: true }
    });
    reply.header('Cache-Control', 'no-store');
    return { rows: rows.map((row) => ({
      ...row,
      surfaceSendOutDates: (row.surfaceSendOutDates as Array<{ date: string; note: string | null }>).map(({ date, note }) => ({ date, note }))
    })) };
  });
}
