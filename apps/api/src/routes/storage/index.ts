import type { FastifyInstance } from 'fastify';
import { registerAssemblyProcedureImageStorageRoutes } from './assembly-procedure-images.js';
import { registerAssemblyProcedureAssetStorageRoutes } from './assembly-procedure-assets.js';
import { registerMeasuringInstrumentGenreStorageRoutes } from './measuring-instrument-genres.js';
import { registerPartMeasurementDrawingStorageRoutes } from './part-measurement-drawings.js';
import { registerPalletMachineIllustrationStorageRoutes } from './pallet-machine-illustrations.js';
import { registerPhotoStorageRoutes } from './photos.js';
import { registerPdfStorageRoutes } from './pdfs.js';
import { registerPdfPageRoutes } from './pdf-pages.js';
import { registerThumbnailStorageRoutes } from './thumbnails.js';

/**
 * ストレージルートの登録
 */
export function registerStorageRoutes(app: FastifyInstance): void {
  registerAssemblyProcedureAssetStorageRoutes(app);
  registerAssemblyProcedureImageStorageRoutes(app);
  registerPhotoStorageRoutes(app);
  registerThumbnailStorageRoutes(app);
  registerPdfStorageRoutes(app);
  registerPdfPageRoutes(app);
  registerPartMeasurementDrawingStorageRoutes(app);
  registerPalletMachineIllustrationStorageRoutes(app);
  registerMeasuringInstrumentGenreStorageRoutes(app);
}
