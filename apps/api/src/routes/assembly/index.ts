import { registerProcedureVideoRoutes } from './procedure-videos.js';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { registerProcedureMaterialRoutes } from './procedure-materials.js';
import { registerProcedureManualRoutes } from './procedure-manuals.js';
import { registerAssemblyProcedureDocumentRevisionRoutes } from './procedure-document-revisions.js';
import { registerAssemblyProcedureDocumentEditLeaseRoutes } from './procedure-document-edit-leases.js';
import { registerAssemblyProcedureDocumentRoutes } from './procedure-documents.js';
import { authorizeRoles } from '../../lib/auth.js';
import { registerBusinessHermesRoutes } from './business-hermes.js';
import { registerBusinessHermesMcpRoutes } from './business-hermes-mcp.js';
import { registerHermesSearchTrialRoutes } from './hermes-search-trial.js';
import { HermesSearchTrialService } from '../../services/business-hermes/hermes-search-trial.service.js';
import { BusinessHermesService } from '../../services/business-hermes/business-hermes.service.js';
import {
  BusinessHermesConsultationService
} from '../../services/business-hermes/business-hermes-consultation.service.js';
import { requireClientDevice } from '../kiosk/shared.js';
import { AssemblyTorqueTraceabilityService } from '../../services/torque-wrenches/index.js';
import {
  AssemblyExcelExportService,
  AssemblyLibraryFilterOptionsService,
  AssemblyLotService,
  AssemblyMachineNameCandidatesService,
  AssemblyOperatorAccessService,
  AssemblyProcedureSequenceService,
  AssemblyProcedureDocumentService,
  AssemblyProcedureDraftImportService,
  createAssemblyProcedureGmailImportService,
  AssemblySeibanLotQuantityService,
  AssemblySeibanStartService,
  AssemblyTemplateService,
  AssemblyWorkSessionService,
  AssemblyWorkSessionRecordApprovalService,
  AssemblyWorkUnitLifecycleService,
  AssemblyTraceabilityService
} from '../../services/assembly/index.js';
import { serializeProcedureSequence } from './serializers.js';
import { registerAssemblyCandidateRoutes, registerAssemblyTemplateRoutes } from './templates.js';
import { registerAssemblyLotRoutes } from './lots.js';
import { registerAssemblyWorkSessionStartRoutes, registerAssemblyWorkSessionRoutes } from './work-sessions.js';
import { registerAssemblyTraceabilityRoutes } from './traceability.js';

export { serializeProcedureSequence } from './serializers.js';

const authOnlyErrorCodes = new Set(['AUTH_TOKEN_REQUIRED', 'AUTH_TOKEN_INVALID', 'AUTH_TOKEN_EXPIRED']);

export async function registerAssemblyRoutes(app: FastifyInstance): Promise<void> {
  const isAuthOnlyError = (error: unknown): boolean => {
    if (!error || typeof error !== 'object') return false;
    const e = error as { statusCode?: number; errorCode?: string };
    return e.statusCode === 401 && (e.errorCode == null || authOnlyErrorCodes.has(e.errorCode));
  };

  const canView = authorizeRoles('ADMIN', 'MANAGER', 'VIEWER');
  const canWrite = authorizeRoles('ADMIN', 'MANAGER');

  const allowView = async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.headers.authorization) {
      try {
        await canView(request, reply);
        return;
      } catch (error) {
        if (!isAuthOnlyError(error)) throw error;
      }
    }
    await requireClientDevice(request.headers['x-client-key']);
    if (reply.statusCode === 401) reply.code(200);
  };

  const allowWriteKiosk = async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.headers.authorization) {
      try {
        await canWrite(request, reply);
        return;
      } catch (error) {
        if (!isAuthOnlyError(error)) throw error;
      }
    }
    await requireClientDevice(request.headers['x-client-key']);
    if (reply.statusCode === 401) reply.code(200);
  };

  const procedureService = new AssemblyProcedureDocumentService();
  const procedureDraftImportService = new AssemblyProcedureDraftImportService(procedureService);
  const procedureGmailImportService = createAssemblyProcedureGmailImportService();
  const libraryFilterOptionsService = new AssemblyLibraryFilterOptionsService();
  const templateService = new AssemblyTemplateService();
  const sessionService = new AssemblyWorkSessionService();
  const traceabilityService = new AssemblyTorqueTraceabilityService();
  const lotService = new AssemblyLotService(sessionService);
  const machineNameCandidatesService = new AssemblyMachineNameCandidatesService();
  const recordApprovalService = new AssemblyWorkSessionRecordApprovalService();
  const operatorAccessService = new AssemblyOperatorAccessService();
  const workUnitLifecycleService = new AssemblyWorkUnitLifecycleService();
  const assemblyTraceabilityService = new AssemblyTraceabilityService();
  const seibanStartService = new AssemblySeibanStartService();
  const seibanLotQuantityService = new AssemblySeibanLotQuantityService();
  const procedureSequenceService = new AssemblyProcedureSequenceService();
  const excelService = new AssemblyExcelExportService(sessionService);
  const businessHermesService = new BusinessHermesService();
  const businessHermesConsultationService = new BusinessHermesConsultationService();

  await registerBusinessHermesRoutes(app, {
    requireClientDevice,
    service: businessHermesService,
    consultationService: businessHermesConsultationService
  });
  await registerBusinessHermesMcpRoutes(app);
  const hermesSearchTrial = new HermesSearchTrialService();
  await registerHermesSearchTrialRoutes(app, hermesSearchTrial);

  registerProcedureMaterialRoutes(app, { allowView, allowWriteKiosk, semanticSearch: hermesSearchTrial });
  registerProcedureVideoRoutes(app, { allowView, allowWriteKiosk });
  registerProcedureManualRoutes(app, { allowView, allowWriteKiosk, serializeSequence: serializeProcedureSequence });

  registerAssemblyProcedureDocumentRevisionRoutes(app, {
    allowView,
    allowWriteKiosk
  });
  registerAssemblyProcedureDocumentEditLeaseRoutes(app, { allowWriteKiosk });

  registerAssemblyCandidateRoutes(app, { allowView, libraryFilterOptionsService, machineNameCandidatesService, seibanStartService, seibanLotQuantityService });

  registerAssemblyProcedureDocumentRoutes(app, {
    allowView,
    allowWriteKiosk,
    procedureService,
    procedureDraftImportService,
    procedureGmailImportService
  });

  registerAssemblyTemplateRoutes(app, { allowView, allowWriteKiosk, templateService });
  registerAssemblyLotRoutes(app, { allowView, allowWriteKiosk, sessionService, lotService });
  registerAssemblyWorkSessionStartRoutes(app, { allowView, allowWriteKiosk, sessionService, operatorAccessService, workUnitLifecycleService });
  registerAssemblyTraceabilityRoutes(app, { allowView, allowWriteKiosk, assemblyTraceabilityService });
  registerAssemblyWorkSessionRoutes(app, { allowView, allowWriteKiosk, sessionService, traceabilityService, recordApprovalService, procedureSequenceService, excelService, businessHermesService });
}
