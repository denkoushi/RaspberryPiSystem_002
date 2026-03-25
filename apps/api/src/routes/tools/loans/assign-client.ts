import type { FastifyInstance } from 'fastify';

import { authorizeRoles } from '../../../lib/auth.js';
import { LoanClientAssignmentService } from '../../../services/tools/loan-client-assignment.service.js';
import { assignLoanClientBodySchema, assignLoanClientParamsSchema } from './schemas.js';

export function registerLoanAssignClientRoute(
  app: FastifyInstance,
  assignmentService: LoanClientAssignmentService
): void {
  const canWrite = authorizeRoles('ADMIN', 'MANAGER');

  app.put('/:id/client', { preHandler: canWrite, config: { rateLimit: false } }, async (request) => {
    const params = assignLoanClientParamsSchema.parse(request.params);
    const body = assignLoanClientBodySchema.parse(request.body);

    const loan = await assignmentService.assignClientToActiveLoan({
      loanId: params.id,
      clientId: body.clientId,
      performedByUserId: request.user?.id,
    });
    return { loan };
  });
}
