import type { FastifyInstance } from 'fastify';
import { env } from '../../../config/env.js';
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
import { registerPhotoSimilarCandidatesRoutes } from './photo-similar-candidates.js';
import { PhotoStorageVisionImageSource } from '../../../services/tools/photo-tool-label/photo-storage-vision-image-source.adapter.js';
import { createHttpPhotoToolImageEmbeddingAdapter } from '../../../services/tools/photo-tool-label/http-photo-tool-image-embedding.adapter.js';
import { PgPhotoToolSimilarityGalleryRepository } from '../../../services/tools/photo-tool-label/pg-photo-tool-similarity-gallery.repository.js';
import { PhotoToolGalleryIndexService } from '../../../services/tools/photo-tool-label/photo-tool-gallery-index.service.js';
import { PhotoToolSimilarCandidateService } from '../../../services/tools/photo-tool-label/photo-tool-similar-candidate.service.js';
import { PhotoToolLabelReviewService } from '../../../services/tools/photo-tool-label/photo-tool-label-review.service.js';

export async function registerLoanRoutes(app: FastifyInstance): Promise<void> {
  const loanService = new LoanService();
  const assignmentService = new LoanClientAssignmentService();

  const visionSource = new PhotoStorageVisionImageSource();
  const embeddingAdapter = createHttpPhotoToolImageEmbeddingAdapter();
  const galleryRepo = new PgPhotoToolSimilarityGalleryRepository(env.PHOTO_TOOL_EMBEDDING_DIMENSION);
  const galleryIndex = new PhotoToolGalleryIndexService(embeddingAdapter, galleryRepo, visionSource);
  const similarCandidateService = new PhotoToolSimilarCandidateService(
    embeddingAdapter,
    galleryRepo,
    visionSource
  );
  const photoLabelReviewService = new PhotoToolLabelReviewService({ galleryIndex });

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
      registerPhotoSimilarCandidatesRoutes(subApp, similarCandidateService);
    },
    { prefix: '/loans' },
  );
}

