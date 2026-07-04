import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { authorizeRoles } from '../../lib/auth.js';
import { logger } from '../../lib/logger.js';
import { assertKioskApiClientKeyValid } from '../../services/clients/client-device-auth.service.js';
import {
  getPartMeasurementDrawingOcrService,
  PART_MEASUREMENT_DRAWING_OCR_QUEUE_PRIORITY,
  PartMeasurementResolveService,
  PartMeasurementSheetService,
  PartMeasurementTemplateCandidateService,
  PartMeasurementTemplateService,
  PartMeasurementVisualTemplateService,
  SelfInspectionService
} from '../../services/part-measurement/index.js';
import { getPartMeasurementDrawingOcrScheduler } from '../../services/part-measurement/part-measurement-drawing-ocr.scheduler.js';
import { SelfInspectionPaperReportIssueService } from '../../services/part-measurement/self-inspection-paper-report-issue.service.js';
import { SelfInspectionPaperReportResolver } from '../../services/part-measurement/self-inspection-paper-report-resolver.service.js';
import { SelfInspectionPaperOcrReviewService } from '../../services/part-measurement/self-inspection-paper-ocr-review.service.js';
import { SelfInspectionPaperImportService } from '../../services/part-measurement/self-inspection-paper-import.service.js';
import { registerVisualTemplateRoutes } from './visual-templates.js';
import { registerSheetRoutes } from './sheets.js';
import { registerProductionTemplateReadRoutes } from './production-templates-read.js';
import { registerSelfInspectionRoutes } from './self-inspection.js';
import { registerProductionTemplateCreateRoutes } from './production-templates-create.js';
import { registerInspectionDrawingTemplateRoutes } from './inspection-drawing-templates.js';
import { registerProductionTemplateLifecycleRoutes } from './production-templates-lifecycle.js';
import { authOnlyErrorCodes, type PartMeasurementRouteDeps } from './shared.js';

export async function registerPartMeasurementRoutes(app: FastifyInstance): Promise<void> {
    const isAuthOnlyError = (error: unknown): boolean => {
      if (!error || typeof error !== 'object') return false;
      const e = error as { statusCode?: number; errorCode?: string };
      return (e.statusCode === 401 && (e.errorCode == null || authOnlyErrorCodes.has(e.errorCode)));
    };

    const canView = authorizeRoles('ADMIN', 'MANAGER', 'VIEWER');
    const canWrite = authorizeRoles('ADMIN', 'MANAGER');

    const allowClientKey = async (request: FastifyRequest) => {
      await assertKioskApiClientKeyValid(request.headers['x-client-key']);
    };

    const allowView = async (request: FastifyRequest, reply: FastifyReply) => {
      if (request.headers.authorization) {
        try {
          await canView(request, reply);
          return;
        } catch (error) {
          if (!isAuthOnlyError(error)) {
            throw error;
          }
        }
      }
      await allowClientKey(request);
      if (reply.statusCode === 401) {
        reply.code(200);
      }
    };

    const allowWriteKiosk = async (request: FastifyRequest, reply: FastifyReply) => {
      if (request.headers.authorization) {
        try {
          await canWrite(request, reply);
          return;
        } catch (error) {
          if (!isAuthOnlyError(error)) {
            throw error;
          }
        }
      }
      await allowClientKey(request);
      if (reply.statusCode === 401) {
        reply.code(200);
      }
    };

    const resolveService = new PartMeasurementResolveService();
    const sheetService = new PartMeasurementSheetService();
    const templateService = new PartMeasurementTemplateService();
    const selfInspectionService = new SelfInspectionService();
    const paperReportIssueService = new SelfInspectionPaperReportIssueService();
    const paperReportResolver = new SelfInspectionPaperReportResolver();
    const paperOcrReviewService = new SelfInspectionPaperOcrReviewService(paperReportResolver);
    const paperImportService = new SelfInspectionPaperImportService();
    const templateCandidateService = new PartMeasurementTemplateCandidateService();
    const visualTemplateService = new PartMeasurementVisualTemplateService();
    const drawingOcrService = getPartMeasurementDrawingOcrService();

    const enqueueDrawingOcrAndWake = async (
      visualTemplateId: string | null | undefined,
      context: string,
      priority: number = PART_MEASUREMENT_DRAWING_OCR_QUEUE_PRIORITY.USER_INITIATED
    ): Promise<void> => {
      const id = visualTemplateId?.trim();
      if (!id) return;
      try {
        await drawingOcrService.enqueueVisualTemplate(id, { priority });
        getPartMeasurementDrawingOcrScheduler().wake();
      } catch (error) {
        logger.warn(
          { err: error, visualTemplateId: id, context },
          'part_measurement_drawing_ocr_enqueue_wake_failed'
        );
      }
    };

    const createInspectionDrawingEvaluationSetup = async (
      templateParams: Parameters<PartMeasurementTemplateService['createInspectionDrawingEvaluationTemplate']>[0],
      clientDeviceId?: string
    ) => {
      const { template, createdVisualTemplateId } =
        await templateService.createInspectionDrawingEvaluationTemplate(templateParams);
      try {
        const sheet = await sheetService.createInspectionDrawingEvaluationDraft(template.id, clientDeviceId);
        await enqueueDrawingOcrAndWake(template.visualTemplateId, 'inspection_drawing_evaluation_setup');
        return { template, sheet };
      } catch (error) {
        await templateService.cleanupInspectionDrawingEvaluationTemplate(template.id, {
          createdVisualTemplateId
        });
        throw error;
      }
    };

  const deps: PartMeasurementRouteDeps = {
    allowView,
    allowWriteKiosk,
    canWrite,
    resolveService,
    sheetService,
    templateService,
    selfInspectionService,
    paperReportIssueService,
    paperReportResolver,
    paperOcrReviewService,
    paperImportService,
    templateCandidateService,
    visualTemplateService,
    drawingOcrService,
    enqueueDrawingOcrAndWake,
    createInspectionDrawingEvaluationSetup
  };

  registerVisualTemplateRoutes(app, deps);
  registerSheetRoutes(app, deps);
  registerProductionTemplateReadRoutes(app, deps);
  registerSelfInspectionRoutes(app, deps);
  registerProductionTemplateCreateRoutes(app, deps);
  registerInspectionDrawingTemplateRoutes(app, deps);
  registerProductionTemplateLifecycleRoutes(app, deps);
}
