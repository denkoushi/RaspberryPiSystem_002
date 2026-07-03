import type { FastifyInstance } from 'fastify';
import type { MultipartFile } from '@fastify/multipart';
import { z } from 'zod';
import { ApiError } from '../../lib/errors.js';
import {
  importDrawingAndSave,
  resolveDrawingMultipartReadLimit
} from '../../lib/part-measurement-drawing-import.js';
import { PartMeasurementDrawingStorage } from '../../lib/part-measurement-drawing-storage.js';




import {
  selfInspectionPatchFromReviseBody,
  resolveTemplateFixedCount,
  serializeSelfInspectionMode
} from '../../services/part-measurement/self-inspection-config.js';






import {
  templateItemSchema,
  createInspectionDrawingTemplateGroupBodySchema,
  addInspectionDrawingTemplateGroupResourcesBodySchema,
  createInspectionDrawingEvaluationTemplateBodySchema,
  reviseTemplateBodySchema,
  kioskInspectionDrawingTemplatesQuerySchema,
  serializeVisualTemplate,
  serializeTemplateProcessGroup,
  serializeTemplateSiblingGroup,
  serializeTemplate,
  readMultipartFile,
  serializeSheet,
  tryGetClientDeviceId,
  selfInspectionFieldsFromBody,
  type PartMeasurementRouteDeps
} from './shared.js';

export function registerInspectionDrawingTemplateRoutes(app: FastifyInstance, deps: PartMeasurementRouteDeps): void {
  const {
    allowView,
    allowWriteKiosk,
    templateService,
    enqueueDrawingOcrAndWake,
    createInspectionDrawingEvaluationSetup
  } = deps;

    app.post(
      '/part-measurement/inspection-drawing/template-groups',
      { preHandler: allowWriteKiosk },
      async (request) => {
        const body = createInspectionDrawingTemplateGroupBodySchema.parse(request.body);
        const processGroup = body.processGroup === 'grinding' ? 'GRINDING' : 'CUTTING';
        const selfInspection = selfInspectionFieldsFromBody(body);
        const result = await templateService.createInspectionDrawingTemplateSiblingGroup({
          fhincd: body.fhincd,
          processGroup,
          resourceCds: body.resourceCds,
          name: body.name,
          displayName: body.displayName,
          items: body.items,
          visualTemplateId: body.visualTemplateId,
          selfInspectionMode: selfInspection.selfInspectionMode,
          selfInspectionFixedCount: selfInspection.selfInspectionFixedCount
        });
        await enqueueDrawingOcrAndWake(body.visualTemplateId, 'inspection_drawing_template_group_create');
        return {
          group: serializeTemplateSiblingGroup(result.group, result.group.activeResourceCds),
          templates: result.templates.map((template) =>
            serializeTemplate({
              ...template,
              visualTemplateId: template.visualTemplateId,
              visualTemplate: template.visualTemplate,
              items: template.items
            })
          )
        };
      }
    );

    app.post(
      '/part-measurement/inspection-drawing/template-groups/:id/revise',
      { preHandler: allowWriteKiosk },
      async (request) => {
        const params = z.object({ id: z.string().uuid() }).parse(request.params);
        const body = reviseTemplateBodySchema.parse(request.body);
        const selfInspectionPatch = selfInspectionPatchFromReviseBody(body);
        const result = await templateService.reviseInspectionDrawingTemplateSiblingGroup(params.id, {
          name: body.name,
          items: body.items,
          visualTemplateId: body.visualTemplateId,
          ...selfInspectionPatch
        });
        await enqueueDrawingOcrAndWake(result.templates[0]?.visualTemplateId, 'inspection_drawing_template_group_revise');
        return {
          group: serializeTemplateSiblingGroup(result.group, result.group.activeResourceCds),
          templates: result.templates.map((template) =>
            serializeTemplate({
              ...template,
              visualTemplateId: template.visualTemplateId,
              visualTemplate: template.visualTemplate,
              items: template.items
            })
          )
        };
      }
    );

    app.post(
      '/part-measurement/inspection-drawing/template-groups/:id/resources',
      { preHandler: allowWriteKiosk },
      async (request) => {
        const params = z.object({ id: z.string().uuid() }).parse(request.params);
        const body = addInspectionDrawingTemplateGroupResourcesBodySchema.parse(request.body);
        const result = await templateService.addResourcesToInspectionDrawingTemplateSiblingGroup(params.id, {
          resourceCds: body.resourceCds,
          sourceTemplateId: body.sourceTemplateId
        });
        await enqueueDrawingOcrAndWake(result.templates[0]?.visualTemplateId, 'inspection_drawing_template_group_add_resources');
        return {
          group: serializeTemplateSiblingGroup(result.group, result.group.activeResourceCds),
          templates: result.templates.map((template) =>
            serializeTemplate({
              ...template,
              visualTemplateId: template.visualTemplateId,
              visualTemplate: template.visualTemplate,
              items: template.items
            })
          )
        };
      }
    );

    app.get('/part-measurement/inspection-drawing/templates', { preHandler: allowView }, async (request) => {
      const q = kioskInspectionDrawingTemplatesQuerySchema.parse(request.query);
      const processGroup =
        q.processGroup === 'grinding' ? 'GRINDING' : q.processGroup === 'cutting' ? 'CUTTING' : undefined;
      const rows = await templateService.listKioskInspectionDrawingTemplates({
        fhincd: q.fhincd,
        processGroup,
        resourceCd: q.resourceCd,
        includeInactive: q.includeInactive === true,
        visualName: q.visualName
      });
      return {
        templates: rows.map(({ template, itemCount }) => ({
          id: template.id,
          fhincd: template.fhincd,
          resourceCd: template.resourceCd,
          processGroup: serializeTemplateProcessGroup(template.processGroup),
          name: template.name,
          version: template.version,
          isActive: template.isActive,
          selfInspectionMode: serializeSelfInspectionMode(template.selfInspectionMode),
          selfInspectionFixedCount: resolveTemplateFixedCount(template),
          selfInspectionSampleSize: resolveTemplateFixedCount(template),
          visualTemplateId: template.visualTemplateId ?? null,
          visualTemplate: template.visualTemplate ? serializeVisualTemplate(template.visualTemplate) : null,
          siblingGroupId: template.siblingGroupId ?? null,
          siblingGroup: template.siblingGroup
            ? serializeTemplateSiblingGroup(
                template.siblingGroup,
                template.siblingGroupActiveResourceCds ?? []
              )
            : null,
          itemCount
        }))
      };
    });

    app.get('/part-measurement/inspection-drawing/templates/:id', { preHandler: allowView }, async (request) => {
      const params = z.object({ id: z.string().uuid() }).parse(request.params);
      const template = await templateService.getKioskInspectionDrawingTemplateById(params.id);
      return {
        template: serializeTemplate({
          ...template,
          visualTemplateId: template.visualTemplateId,
          visualTemplate: template.visualTemplate,
          items: template.items
        })
      };
    });

    app.post(
      '/part-measurement/inspection-drawing/templates/:id/revise',
      { preHandler: allowWriteKiosk },
      async (request) => {
        const params = z.object({ id: z.string().uuid() }).parse(request.params);
        const body = reviseTemplateBodySchema.parse(request.body);
        const selfInspectionPatch = selfInspectionPatchFromReviseBody(body);
        const template = await templateService.reviseKioskInspectionDrawingTemplate(params.id, {
          name: body.name,
          items: body.items,
          visualTemplateId: body.visualTemplateId,
          detachFromSiblingGroup: body.detachFromSiblingGroup === true,
          ...selfInspectionPatch
        });
        await enqueueDrawingOcrAndWake(template.visualTemplateId, 'inspection_drawing_template_revise');
        return {
          template: serializeTemplate({
            ...template,
            visualTemplateId: template.visualTemplateId,
            visualTemplate: template.visualTemplate,
            items: template.items
          })
        };
      }
    );

    app.post(
      '/part-measurement/inspection-drawing/evaluation-templates',
      { preHandler: allowWriteKiosk, config: { rateLimit: false } },
      async (request) => {
        if (request.isMultipart()) {
          let fileBuffer: Buffer | null = null;
          let mimetype = '';
          let filename = '';
          let name = '';
          let referenceFhincd = '';
          let referenceResourceCd = '';
          let referenceProcessGroup: 'cutting' | 'grinding' = 'cutting';
          let itemsJson = '';

          const parts = request.parts();
          for await (const part of parts) {
            if (part.type === 'file') {
              if (part.fieldname === 'file') {
                const mf = part as MultipartFile;
                mimetype = mf.mimetype || '';
                filename = mf.filename || 'drawing';
                const { maxBytes, tooLargeMessage } = resolveDrawingMultipartReadLimit(mimetype, filename);
                fileBuffer = await readMultipartFile(mf, maxBytes, tooLargeMessage);
              }
            } else if (part.fieldname === 'name') {
              name = String(part.value ?? '').trim();
            } else if (part.fieldname === 'referenceFhincd') {
              referenceFhincd = String(part.value ?? '').trim();
            } else if (part.fieldname === 'referenceResourceCd') {
              referenceResourceCd = String(part.value ?? '').trim();
            } else if (part.fieldname === 'referenceProcessGroup') {
              const pg = String(part.value ?? '').trim();
              referenceProcessGroup = pg === 'grinding' ? 'grinding' : 'cutting';
            } else if (part.fieldname === 'items') {
              itemsJson = String(part.value ?? '');
            }
          }

          if (!fileBuffer || fileBuffer.length === 0) {
            throw new ApiError(400, '図面ファイルが必要です');
          }
          if (!name) {
            name = filename.replace(/\.[^.]+$/, '') || '検査図面';
          }

          let items: z.infer<typeof templateItemSchema>[];
          try {
            items = z.array(templateItemSchema).min(1).max(200).parse(JSON.parse(itemsJson || '[]'));
          } catch {
            throw new ApiError(400, 'items が不正です（JSON 配列）');
          }

          const body = createInspectionDrawingEvaluationTemplateBodySchema.parse({
            referenceFhincd,
            referenceResourceCd,
            referenceProcessGroup,
            name,
            items
          });

          const { relativeUrl } = await importDrawingAndSave({
            buffer: fileBuffer,
            mimetype,
            filename
          });

          const prismaProcessGroup = body.referenceProcessGroup === 'grinding' ? 'GRINDING' : 'CUTTING';
          const clientDeviceId = await tryGetClientDeviceId(request.headers);
          try {
            const { template, sheet } = await createInspectionDrawingEvaluationSetup(
              {
                referenceFhincd: body.referenceFhincd,
                referenceResourceCd: body.referenceResourceCd,
                referenceProcessGroup: prismaProcessGroup,
                name: body.name,
                items: body.items,
                drawingUpload: {
                  relativeUrl,
                  displayName: name
                }
              },
              clientDeviceId
            );
            return {
              template: serializeTemplate({
                ...template,
                visualTemplateId: template.visualTemplateId,
                visualTemplate: template.visualTemplate,
                items: template.items
              }),
              sheet: serializeSheet(sheet)
            };
          } catch (error) {
            await PartMeasurementDrawingStorage.deleteDrawing(relativeUrl).catch(() => undefined);
            throw error;
          }
        }

        const body = createInspectionDrawingEvaluationTemplateBodySchema.parse(request.body);
        if (!body.visualTemplateId) {
          throw new ApiError(400, 'visualTemplateId または multipart（file）が必要です');
        }
        const referenceProcessGroup = body.referenceProcessGroup === 'grinding' ? 'GRINDING' : 'CUTTING';
        const clientDeviceId = await tryGetClientDeviceId(request.headers);
        const { template, sheet } = await createInspectionDrawingEvaluationSetup(
          {
            referenceFhincd: body.referenceFhincd,
            referenceResourceCd: body.referenceResourceCd,
            referenceProcessGroup,
            name: body.name,
            items: body.items,
            visualTemplateId: body.visualTemplateId
          },
          clientDeviceId
        );
        return {
          template: serializeTemplate({
            ...template,
            visualTemplateId: template.visualTemplateId,
            visualTemplate: template.visualTemplate,
            items: template.items
          }),
          sheet: serializeSheet(sheet)
        };
      }
    );
}
