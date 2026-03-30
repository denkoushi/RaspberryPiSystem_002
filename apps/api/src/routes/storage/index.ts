import type { FastifyInstance } from 'fastify';
import { registerPartMeasurementDrawingStorageRoutes } from './part-measurement-drawings.js';
import { registerPhotoStorageRoutes } from './photos.js';
import { registerPdfStorageRoutes } from './pdfs.js';
import { registerPdfPageRoutes } from './pdf-pages.js';

/**
 * ストレージルートの登録
 */
export function registerStorageRoutes(app: FastifyInstance): void {
  registerPhotoStorageRoutes(app);
  registerPdfStorageRoutes(app);
  registerPdfPageRoutes(app);
  registerPartMeasurementDrawingStorageRoutes(app);
}

