import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { MultipartFile } from '@fastify/multipart';

import { authorizeRoles } from '../../../lib/auth.js';
import { ApiError } from '../../../lib/errors.js';
import { PhotoGallerySeedService } from '../../../services/tools/photo-tool-label/photo-gallery-seed.service.js';

async function readMultipartFile(part: MultipartFile): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of part.file) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export function registerPhotoGallerySeedRoute(
  app: FastifyInstance,
  seedService: PhotoGallerySeedService
): void {
  const canManage = authorizeRoles('ADMIN', 'MANAGER');

  app.post('/photo-gallery-seed', { preHandler: canManage }, async (request: FastifyRequest) => {
    if (!request.isMultipart()) {
      throw new ApiError(
        400,
        'multipart/form-data が必要です。Content-Type: multipart/form-data を指定してください',
        undefined,
        'PHOTO_GALLERY_SEED_MULTIPART_REQUIRED'
      );
    }

    const reviewerUserId = request.user?.id;
    if (!reviewerUserId) {
      throw new ApiError(401, '認証が必要です', undefined, 'AUTH_TOKEN_REQUIRED');
    }

    let imageBuffer: Buffer | null = null;
    let canonicalLabelRaw = '';

    const parts = request.parts();
    for await (const part of parts) {
      if (part.type === 'file' && part.fieldname === 'image') {
        imageBuffer = await readMultipartFile(part as MultipartFile);
      } else if (part.type === 'field' && part.fieldname === 'canonicalLabel') {
        canonicalLabelRaw = String(part.value ?? '');
      }
    }

    if (!imageBuffer || imageBuffer.length === 0) {
      throw new ApiError(400, 'image フィールドに JPEG を指定してください', undefined, 'PHOTO_GALLERY_SEED_IMAGE_REQUIRED');
    }

    const result = await seedService.createFromUpload({
      jpegBuffer: imageBuffer,
      canonicalLabelRaw,
      reviewerUserId,
    });

    return result;
  });
}
