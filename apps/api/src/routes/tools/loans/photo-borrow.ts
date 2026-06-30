import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { LoanService } from '../../../services/tools/loan.service.js';
import { resolveAuthorizedLoanClientId } from './auth.js';

const photoBorrowSchema = z.object({
  employeeTagUid: z.string().min(1, '従業員タグUIDは必須です'),
  photoData: z.string().min(1, '写真データは必須です'), // Base64エンコードされたJPEG画像データ
  clientId: z.string().optional(),
  note: z.string().nullable().optional(),
});

export function registerPhotoBorrowRoute(app: FastifyInstance, loanService: LoanService): void {
  app.post('/photo-borrow', { config: { rateLimit: false } }, async (request, reply) => {
    const body = photoBorrowSchema.parse(request.body);
    const resolvedClientId = await resolveAuthorizedLoanClientId(request, reply, body.clientId, 'write');

    const loan = await loanService.photoBorrow(body, resolvedClientId);
    return { loan };
  });
}
