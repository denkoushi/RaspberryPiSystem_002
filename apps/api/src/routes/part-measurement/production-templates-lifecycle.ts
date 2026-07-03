import type { FastifyInstance } from 'fastify';
import { z } from 'zod';


import {
  PART_MEASUREMENT_DRAWING_OCR_QUEUE_PRIORITY
} from '../../services/part-measurement/index.js';


import {
  selfInspectionPatchFromReviseBody
} from '../../services/part-measurement/self-inspection-config.js';






import {
  reviseTemplateBodySchema,
  cloneTemplateForScheduleBodySchema,
  serializeTemplate,
  type PartMeasurementRouteDeps
} from './shared.js';

export function registerProductionTemplateLifecycleRoutes(app: FastifyInstance, deps: PartMeasurementRouteDeps): void {
  const {
    allowWriteKiosk,
    templateService,
    enqueueDrawingOcrAndWake
  } = deps;

    app.post(
      '/part-measurement/templates/clone-for-schedule-key',
      { preHandler: allowWriteKiosk, config: { rateLimit: false } },
      async (request) => {
        const body = cloneTemplateForScheduleBodySchema.parse(request.body);
        const processGroup = body.processGroup === 'grinding' ? 'GRINDING' : 'CUTTING';
        const result = await templateService.cloneActiveTemplateToScheduleKey({
          sourceTemplateId: body.sourceTemplateId,
          targetFhincd: body.fhincd,
          targetProcessGroup: processGroup,
          targetResourceCd: body.resourceCd
        });
        await enqueueDrawingOcrAndWake(result.template.visualTemplateId, 'template_clone_for_schedule_key');
        return {
          template: serializeTemplate({
            ...result.template,
            visualTemplateId: result.template.visualTemplateId,
            visualTemplate: result.template.visualTemplate,
            items: result.template.items
          }),
          reusedExistingActive: result.reusedExistingActive,
          didClone: result.didClone
        };
      }
    );

    app.post('/part-measurement/templates/:id/revise', { preHandler: allowWriteKiosk }, async (request) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      const body = reviseTemplateBodySchema.parse(request.body);
      const selfInspectionPatch = selfInspectionPatchFromReviseBody(body);
      const template = await templateService.reviseActiveTemplate(params.id, {
        name: body.name,
        items: body.items,
        visualTemplateId: body.visualTemplateId,
        candidateFhinmei: body.candidateFhinmei,
        detachFromSiblingGroup: body.detachFromSiblingGroup === true,
        ...selfInspectionPatch
      });
      await enqueueDrawingOcrAndWake(template.visualTemplateId, 'template_revise');
      return {
        template: serializeTemplate({
          ...template,
          visualTemplateId: template.visualTemplateId,
          visualTemplate: template.visualTemplate,
          items: template.items
        })
      };
    });

    app.post('/part-measurement/templates/:id/retire', { preHandler: allowWriteKiosk }, async (request) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      const template = await templateService.retireActiveTemplate(params.id);
      return {
        template: serializeTemplate({
          ...template,
          visualTemplateId: template.visualTemplateId,
          visualTemplate: template.visualTemplate,
          items: template.items
        })
      };
    });

    app.post('/part-measurement/templates/:id/activate', { preHandler: allowWriteKiosk }, async (request) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      const template = await templateService.setActiveVersion(params.id);
      await enqueueDrawingOcrAndWake(
        template.visualTemplateId,
        'template_activate',
        PART_MEASUREMENT_DRAWING_OCR_QUEUE_PRIORITY.REFERENCED_ACTIVE
      );
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
