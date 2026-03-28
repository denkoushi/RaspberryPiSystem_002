import type { FastifyInstance } from 'fastify';

import { authorizeRoles } from '../../../lib/auth.js';
import { ApiError } from '../../../lib/errors.js';
import { PhotoToolLabelReviewService } from '../../../services/tools/photo-tool-label/photo-tool-label-review.service.js';

import {
  loanParamsSchema,
  photoLabelReviewListQuerySchema,
  photoLabelReviewPatchBodySchema,
} from './schemas.js';

export function registerPhotoLabelReviewsRoutes(
  app: FastifyInstance,
  reviewService: PhotoToolLabelReviewService
): void {
  const canManage = authorizeRoles('ADMIN', 'MANAGER');

  app.get('/photo-label-reviews', { preHandler: canManage }, async (request) => {
    const query = photoLabelReviewListQuerySchema.parse(request.query);
    const items = await reviewService.listPhotoLabelReviews(query.limit);
    return { items };
  });

  app.patch('/:id/photo-label-review', { preHandler: canManage }, async (request) => {
    const params = loanParamsSchema.parse(request.params);
    const body = photoLabelReviewPatchBodySchema.parse(request.body);
    const reviewerUserId = request.user?.id;
    if (!reviewerUserId) {
      throw new ApiError(401, '認証が必要です', undefined, 'AUTH_TOKEN_REQUIRED');
    }

    let humanDisplayNameUpdate: string | null | undefined;
    if (Object.prototype.hasOwnProperty.call(body, 'humanDisplayName')) {
      humanDisplayNameUpdate = body.humanDisplayName ?? null;
    }

    const row = await reviewService.submitReview({
      loanId: params.id,
      reviewerUserId,
      quality: body.quality,
      humanDisplayNameUpdate,
    });
    return { item: row };
  });
}
