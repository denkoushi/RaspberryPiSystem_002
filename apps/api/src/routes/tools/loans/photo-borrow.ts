import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { LoanService } from '../../../services/tools/loan.service.js';

const photoBorrowSchema = z.object({
  employeeTagUid: z.string().min(1, '従業員タグUIDは必須です'),
  photoData: z.string().min(1, '写真データは必須です'), // Base64エンコードされたJPEG画像データ
  clientId: z.string().optional(),
  note: z.string().nullable().optional(),
});
const idempotencyKeySchema = z.string().uuid('Idempotency-KeyはUUID形式で指定してください');

export function registerPhotoBorrowRoute(app: FastifyInstance, loanService: LoanService): void {
  app.post('/photo-borrow', { config: { rateLimit: false } }, async (request) => {
    const body = photoBorrowSchema.parse(request.body);
    const headerKey = request.headers['x-client-key'];
    const resolvedClientId = await loanService.resolveClientId(body.clientId, headerKey);
    const rawIdempotencyKey = request.headers['idempotency-key'];
    const idempotencyKey = rawIdempotencyKey === undefined
      ? undefined
      : idempotencyKeySchema.parse(Array.isArray(rawIdempotencyKey) ? rawIdempotencyKey[0] : rawIdempotencyKey);

    const loan = await loanService.photoBorrow({ ...body, idempotencyKey }, resolvedClientId);
    return { loan };
  });
}
