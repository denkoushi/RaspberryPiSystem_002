import type { FastifyInstance } from 'fastify';
import { LoanService } from '../../../services/tools/loan.service.js';
import { registerBorrowRoute } from './borrow.js';
import { registerReturnRoute } from './return.js';
import { registerActiveLoansRoute } from './active.js';
import { registerPhotoBorrowRoute } from './photo-borrow.js';

export async function registerLoanRoutes(app: FastifyInstance): Promise<void> {
  const loanService = new LoanService();

  await app.register(
    async (subApp) => {
      registerBorrowRoute(subApp, loanService);
      registerReturnRoute(subApp, loanService);
      registerActiveLoansRoute(subApp, loanService);
      registerPhotoBorrowRoute(subApp, loanService);
    },
    { prefix: '/loans' },
  );
}

