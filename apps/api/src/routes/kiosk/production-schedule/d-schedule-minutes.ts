import type { FastifyInstance } from 'fastify';

import { prisma } from '../../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../../../services/production-schedule/constants.js';
import type { DScheduleMinutesKind } from '../../../services/production-schedule/d-schedule-minutes/minutes-kind.js';
import type { KioskRouteDeps } from './shared.js';
import { TERMINAL_ROUTE_RATE_LIMIT } from '../../../lib/terminal-route-rate-limit.js';

export async function registerProductionScheduleDScheduleMinutesRoute(app: FastifyInstance, deps: KioskRouteDeps): Promise<void> {
  app.get('/kiosk/production-schedule/d-schedule-minutes', { config: { rateLimit: TERMINAL_ROUTE_RATE_LIMIT } }, async (request, reply) => {
    await deps.requireClientDevice(request.headers['x-client-key']);
    const latestReceivedAt = (kind: DScheduleMinutesKind) => prisma.productionScheduleDScheduleMinutesImportRun.findFirst({
      where: { kind, status: 'SUCCESS' }, orderBy: [{ meetingDate: 'desc' }, { receivedAt: 'desc' }], select: { receivedAt: true }
    });
    const [rows, dCompany, internal] = await Promise.all([
      prisma.productionScheduleDScheduleMinutes.findMany({
        where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID },
        orderBy: { fseiban: 'asc' },
        select: { fseiban: true, outsourceMarks: true, surfaceSendOutDates: true, memo: true }
      }),
      latestReceivedAt('D_COMPANY'),
      latestReceivedAt('INTERNAL')
    ]);
    reply.header('Cache-Control', 'no-store');
    return { latestReceivedAt: { D_COMPANY: dCompany?.receivedAt.toISOString() ?? null, INTERNAL: internal?.receivedAt.toISOString() ?? null }, rows: rows.map((row) => ({
      ...row,
      surfaceSendOutDates: (row.surfaceSendOutDates as Array<{ date: string; note: string | null }>).map(({ date, note }) => ({ date, note }))
    })) };
  });
}
