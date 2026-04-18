import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authorizeRoles } from '../../lib/auth.js';
import { LoanReportService } from '../../services/reports/loan-report/loan-report.service.js';

const loanReportCategorySchema = z.enum(['measuring', 'rigging', 'tools']);

const loanReportPreviewQuerySchema = z.object({
  category: loanReportCategorySchema,
  periodFrom: z.coerce.date().optional(),
  periodTo: z.coerce.date().optional(),
  monthlyMonths: z.coerce.number().int().min(1).max(24).optional(),
  timeZone: z.string().min(1).optional(),
  site: z.string().optional(),
  author: z.string().optional(),
  measuringInstrumentId: z.string().optional(),
  riggingGearId: z.string().optional(),
  itemId: z.string().optional(),
});

const loanReportGmailDraftBodySchema = loanReportPreviewQuerySchema.extend({
  subject: z.string().trim().min(1),
  to: z.string().trim().optional(),
});

const loanReportGmailSendBodySchema = loanReportPreviewQuerySchema.extend({
  subject: z.string().trim().min(1),
  to: z.string().trim().min(1),
});

function isUtcMidnight(d: Date): boolean {
  return (
    d.getUTCHours() === 0 &&
    d.getUTCMinutes() === 0 &&
    d.getUTCSeconds() === 0 &&
    d.getUTCMilliseconds() === 0
  );
}

function asIsoDateFromUtcDate(d: Date): string {
  const y = String(d.getUTCFullYear());
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function asStartOfDay(d: Date, timeZone: 'UTC' | 'Asia/Tokyo'): Date {
  const isoDate = asIsoDateFromUtcDate(d);
  if (timeZone === 'UTC') {
    return new Date(`${isoDate}T00:00:00.000Z`);
  }
  return new Date(`${isoDate}T00:00:00.000+09:00`);
}

function asEndOfDay(d: Date, timeZone: 'UTC' | 'Asia/Tokyo'): Date {
  const isoDate = asIsoDateFromUtcDate(d);
  if (timeZone === 'UTC') {
    return new Date(`${isoDate}T23:59:59.999Z`);
  }
  return new Date(`${isoDate}T23:59:59.999+09:00`);
}

export function resolveLoanReportPeriod(params: {
  periodFrom?: Date;
  periodTo?: Date;
  timeZone?: string;
  now?: Date;
}): { periodFrom: Date; periodTo: Date } {
  const now = params.now ?? new Date();
  const timeZone: 'UTC' | 'Asia/Tokyo' = params.timeZone === 'UTC' ? 'UTC' : 'Asia/Tokyo';
  let periodTo = params.periodTo ?? now;
  let periodFrom = params.periodFrom ?? new Date(periodTo.getTime() - 90 * 24 * 60 * 60 * 1000);
  if (params.periodFrom && isUtcMidnight(params.periodFrom)) {
    periodFrom = asStartOfDay(params.periodFrom, timeZone);
  }
  if (params.periodTo && isUtcMidnight(params.periodTo)) {
    periodTo = asEndOfDay(params.periodTo, timeZone);
  }
  return { periodFrom, periodTo };
}

export function registerLoanReportRoutes(app: FastifyInstance): void {
  const canPreview = authorizeRoles('ADMIN', 'MANAGER', 'VIEWER');
  const canDraft = authorizeRoles('ADMIN', 'MANAGER');
  const canSendGmail = authorizeRoles('ADMIN');
  const service = LoanReportService.createDefault();

  app.get(
    '/reports/loan-report/preview',
    { preHandler: [canPreview], config: { rateLimit: false } },
    async (request) => {
      const q = loanReportPreviewQuerySchema.parse(request.query);
      const { periodFrom, periodTo } = resolveLoanReportPeriod({
        periodFrom: q.periodFrom,
        periodTo: q.periodTo,
        timeZone: q.timeZone,
      });
      return service.buildPreview({
        category: q.category,
        periodFrom,
        periodTo,
        monthlyMonths: q.monthlyMonths ?? 6,
        timeZone: q.timeZone,
        site: q.site,
        author: q.author,
        measuringInstrumentId: q.measuringInstrumentId,
        riggingGearId: q.riggingGearId,
        itemId: q.itemId,
      });
    }
  );

  app.post(
    '/reports/loan-report/gmail-draft',
    { preHandler: [canDraft], config: { rateLimit: false } },
    async (request) => {
      const body = loanReportGmailDraftBodySchema.parse(request.body);
      const { periodFrom, periodTo } = resolveLoanReportPeriod({
        periodFrom: body.periodFrom,
        periodTo: body.periodTo,
        timeZone: body.timeZone,
      });
      return service.createGmailDraft({
        category: body.category,
        periodFrom,
        periodTo,
        monthlyMonths: body.monthlyMonths ?? 6,
        timeZone: body.timeZone,
        site: body.site,
        author: body.author,
        measuringInstrumentId: body.measuringInstrumentId,
        riggingGearId: body.riggingGearId,
        itemId: body.itemId,
        subject: body.subject,
        to: body.to,
      });
    }
  );

  app.post(
    '/reports/loan-report/gmail-send',
    { preHandler: [canSendGmail], config: { rateLimit: false } },
    async (request) => {
      const body = loanReportGmailSendBodySchema.parse(request.body);
      const { periodFrom, periodTo } = resolveLoanReportPeriod({
        periodFrom: body.periodFrom,
        periodTo: body.periodTo,
        timeZone: body.timeZone,
      });
      return service.sendGmailMessage({
        category: body.category,
        periodFrom,
        periodTo,
        monthlyMonths: body.monthlyMonths ?? 6,
        timeZone: body.timeZone,
        site: body.site,
        author: body.author,
        measuringInstrumentId: body.measuringInstrumentId,
        riggingGearId: body.riggingGearId,
        itemId: body.itemId,
        subject: body.subject,
        to: body.to,
      });
    }
  );
}
