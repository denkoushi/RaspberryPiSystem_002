import type { FastifyInstance } from 'fastify';














import {
  listTemplatesQuerySchema,
  activeTemplateExistsQuerySchema,
  listTemplateCandidatesQuerySchema,
  serializeTemplate,
  type PartMeasurementRouteDeps
} from './shared.js';

export function registerProductionTemplateReadRoutes(app: FastifyInstance, deps: PartMeasurementRouteDeps): void {
  const {
    allowView,
    templateService,
    templateCandidateService
  } = deps;

    app.get('/part-measurement/templates/candidates', { preHandler: allowView }, async (request) => {
      const q = listTemplateCandidatesQuerySchema.parse(request.query);
      const processGroup = q.processGroup === 'grinding' ? 'GRINDING' : 'CUTTING';
      const rows = await templateCandidateService.listCandidates({
        fhincd: q.fhincd,
        processGroup,
        resourceCd: q.resourceCd,
        fhinmei: q.fhinmei,
        q: q.q
      });
      return {
        candidates: rows.map((row) => ({
          matchKind: row.matchKind,
          selectable: row.selectable,
          itemCount: row.itemCount,
          template: serializeTemplate({ ...row.template, items: [] })
        }))
      };
    });

    app.get('/part-measurement/templates/active-exists', { preHandler: allowView }, async (request) => {
      const q = activeTemplateExistsQuerySchema.parse(request.query);
      const processGroup = q.processGroup === 'grinding' ? 'GRINDING' : 'CUTTING';
      const exists = await templateService.existsActiveProductionThreeKeyTemplate(
        q.fhincd,
        processGroup,
        q.resourceCd
      );
      return { exists };
    });

    app.get('/part-measurement/templates', { preHandler: allowView }, async (request) => {
      const q = listTemplatesQuerySchema.parse(request.query);
      const processGroup =
        q.processGroup === 'grinding' ? 'GRINDING' : q.processGroup === 'cutting' ? 'CUTTING' : undefined;
      const list = await templateService.listTemplates({
        fhincd: q.fhincd,
        processGroup,
        resourceCd: q.resourceCd,
        includeInactive: q.includeInactive === true
      });
      return { templates: list.map((t) => serializeTemplate({ ...t, items: t.items })) };
    });
}
