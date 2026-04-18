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
  subject: z.string().min(1),
  to: z.string().optional(),
});

export function registerLoanReportRoutes(app: FastifyInstance): void {
  const canPreview = authorizeRoles('ADMIN', 'MANAGER', 'VIEWER');
  const canDraft = authorizeRoles('ADMIN', 'MANAGER');
  const service = LoanReportService.createDefault();

  app.get(
    '/reports/loan-report/preview',
    { preHandler: [canPreview], config: { rateLimit: false } },
    async (request) => {
      const q = loanReportPreviewQuerySchema.parse(request.query);
      const now = new Date();
      const periodTo = q.periodTo ?? now;
      const periodFrom = q.periodFrom ?? new Date(periodTo.getTime() - 90 * 24 * 60 * 60 * 1000);
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
      const now = new Date();
      const periodTo = body.periodTo ?? now;
      const periodFrom = body.periodFrom ?? new Date(periodTo.getTime() - 90 * 24 * 60 * 60 * 1000);
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
}
