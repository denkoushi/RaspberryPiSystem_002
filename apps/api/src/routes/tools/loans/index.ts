import type { FastifyInstance } from 'fastify';
import { LoanService } from '../../../services/tools/loan.service.js';
import { registerBorrowRoute } from './borrow.js';
import { registerReturnRoute } from './return.js';
import { registerActiveLoansRoute } from './active.js';

export async function registerLoanRoutes(app: FastifyInstance): Promise<void> {
  const loanService = new LoanService();

  registerBorrowRoute(app, loanService);
  registerReturnRoute(app, loanService);
  registerActiveLoansRoute(app, loanService);
}

