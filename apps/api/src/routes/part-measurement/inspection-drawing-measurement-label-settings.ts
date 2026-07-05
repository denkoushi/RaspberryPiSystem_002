import type { FastifyInstance } from 'fastify';

import {
  updateInspectionDrawingMeasurementLabelSettingsBodySchema,
  type PartMeasurementRouteDeps
} from './shared.js';

export function registerInspectionDrawingMeasurementLabelSettingRoutes(
  app: FastifyInstance,
  deps: PartMeasurementRouteDeps
): void {
  const { allowView, canWrite, measurementLabelSettingsService } = deps;

  app.get(
    '/part-measurement/inspection-drawing/measurement-label-settings',
    { preHandler: allowView },
    async () => {
      return {
        settings: await measurementLabelSettingsService.listSettings()
      };
    }
  );

  app.patch(
    '/part-measurement/inspection-drawing/measurement-label-settings',
    { preHandler: canWrite },
    async (request) => {
      const body = updateInspectionDrawingMeasurementLabelSettingsBodySchema.parse(request.body);
      return {
        settings: await measurementLabelSettingsService.replaceSettings(body.settings)
      };
    }
  );
}
