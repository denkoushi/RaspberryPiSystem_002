import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { LoanService } from '../../../services/tools/loan.service.js';

const photoBorrowSchema = z.object({
  employeeTagUid: z.string().min(1, '従業員タグUIDは必須です'),
  clientId: z.string().optional(),
  note: z.string().nullable().optional(),
});

export function registerPhotoBorrowRoute(app: FastifyInstance, loanService: LoanService): void {
  app.post('/photo-borrow', { config: { rateLimit: false } }, async (request) => {
    const body = photoBorrowSchema.parse(request.body);
    const headerKey = request.headers['x-client-key'];
    const resolvedClientId = await loanService.resolveClientId(body.clientId, headerKey);

    const loan = await loanService.photoBorrow(body, resolvedClientId);
    return { loan };
  });
}

