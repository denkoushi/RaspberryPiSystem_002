import type { FastifyInstance } from 'fastify';
import { registerPhotoStorageRoutes } from './photos.js';
import { registerPdfStorageRoutes } from './pdfs.js';

/**
 * ストレージルートの登録
 */
export function registerStorageRoutes(app: FastifyInstance): void {
  registerPhotoStorageRoutes(app);
  registerPdfStorageRoutes(app);
}

