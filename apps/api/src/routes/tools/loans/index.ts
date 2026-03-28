import type { FastifyInstance } from 'fastify';
import { LoanService } from '../../../services/tools/loan.service.js';
import { LoanClientAssignmentService } from '../../../services/tools/loan-client-assignment.service.js';
import { registerBorrowRoute } from './borrow.js';
import { registerReturnRoute } from './return.js';
import { registerActiveLoansRoute } from './active.js';
import { registerPhotoBorrowRoute } from './photo-borrow.js';
import { registerLoanDeleteRoute } from './delete.js';
import { registerLoanCancelRoute } from './cancel.js';
import { registerLoanAssignClientRoute } from './assign-client.js';
import { registerPhotoLabelReviewsRoutes } from './photo-label-reviews.js';
import { PhotoToolLabelReviewService } from '../../../services/tools/photo-tool-label/photo-tool-label-review.service.js';

export async function registerLoanRoutes(app: FastifyInstance): Promise<void> {
  const loanService = new LoanService();
  const assignmentService = new LoanClientAssignmentService();
  const photoLabelReviewService = new PhotoToolLabelReviewService();

  await app.register(
    async (subApp) => {
      registerBorrowRoute(subApp, loanService);
      registerReturnRoute(subApp, loanService);
      registerActiveLoansRoute(subApp, loanService);
      registerPhotoBorrowRoute(subApp, loanService);
      registerLoanDeleteRoute(subApp, loanService);
      registerLoanCancelRoute(subApp, loanService);
      registerLoanAssignClientRoute(subApp, assignmentService);
      registerPhotoLabelReviewsRoutes(subApp, photoLabelReviewService);
    },
    { prefix: '/loans' },
  );
}

