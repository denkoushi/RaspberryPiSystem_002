import type { FastifyInstance } from 'fastify';

import { authorizeRoles } from '../../../lib/auth.js';
import { PhotoToolSimilarCandidateService } from '../../../services/tools/photo-tool-label/photo-tool-similar-candidate.service.js';

import { loanParamsSchema } from './schemas.js';

export function registerPhotoSimilarCandidatesRoutes(
  app: FastifyInstance,
  similarCandidateService: PhotoToolSimilarCandidateService
): void {
  const canManage = authorizeRoles('ADMIN', 'MANAGER');

  app.get('/:id/photo-similar-candidates', { preHandler: canManage }, async (request) => {
    const params = loanParamsSchema.parse(request.params);
    return similarCandidateService.getCandidates(params.id);
  });
}
