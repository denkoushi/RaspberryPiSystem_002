import type { FastifyInstance } from 'fastify';














import {
  createTemplateBodySchema,
  serializeTemplate,
  selfInspectionFieldsFromBody,
  type PartMeasurementRouteDeps
} from './shared.js';

export function registerProductionTemplateCreateRoutes(app: FastifyInstance, deps: PartMeasurementRouteDeps): void {
  const {
    allowWriteKiosk,
    templateService,
    enqueueDrawingOcrAndWake
  } = deps;

    app.post('/part-measurement/templates', { preHandler: allowWriteKiosk }, async (request) => {
      const body = createTemplateBodySchema.parse(request.body);
      const processGroup = body.processGroup === 'grinding' ? 'GRINDING' : 'CUTTING';
      const templateScope =
        body.templateScope === 'fhincd_resource'
          ? 'FHINCD_RESOURCE'
          : body.templateScope === 'fhinmei_only'
            ? 'FHINMEI_ONLY'
            : 'THREE_KEY';
      const selfInspection = selfInspectionFieldsFromBody(body);
      const template = await templateService.createTemplateVersion({
        fhincd: body.fhincd,
        processGroup,
        resourceCd: body.resourceCd,
        name: body.name,
        items: body.items,
        visualTemplateId: body.visualTemplateId ?? null,
        templateScope,
        candidateFhinmei: body.candidateFhinmei,
        selfInspectionMode: selfInspection.selfInspectionMode,
        selfInspectionFixedCount: selfInspection.selfInspectionFixedCount,
        failIfActiveExists: body.failIfActiveExists === true
      });
      await enqueueDrawingOcrAndWake(template.visualTemplateId, 'template_create');
      return {
        template: serializeTemplate({
          ...template,
          visualTemplateId: template.visualTemplateId,
          visualTemplate: template.visualTemplate,
          items: template.items
        })
      };
    });
}
