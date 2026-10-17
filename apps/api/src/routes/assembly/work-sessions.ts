import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';
import { BusinessHermesService } from '../../services/business-hermes/business-hermes.service.js';
import { requireKioskClientDevice } from '../../services/clients/client-device-auth.service.js';
import { AssemblyTorqueTraceabilityService } from '../../services/torque-wrenches/index.js';
import { agentTorqueRecordSchema } from '../torque-wrenches/schemas.js';
import {
  AssemblyExcelExportService,
  AssemblyOperatorAccessService,
  AssemblyProcedureSequenceService,
  AssemblyWorkSessionService,
  AssemblyWorkSessionRecordApprovalService,
  AssemblyWorkUnitLifecycleService,
  toPrismaTorqueInputSource
} from '../../services/assembly/index.js';
import {
  idParamSchema,
  recordCheckBodySchema,
  startSessionBodySchema,
  recordTorqueBodySchema,
  approveAssemblyRecordApprovalBodySchema,
  operatorAccessBodySchema,
  invalidateAssemblyWorkUnitBodySchema
} from './schemas.js';
import {
  serializeProcedureSequence,
  serializeCheckSummary,
  serializeCheckRecord,
  serializeSessionSummary,
  serializeSession
} from './serializers.js';
import { tryGetClientDevice, buildAssemblyTraceabilityActor } from './shared.js';

export function registerAssemblyWorkSessionStartRoutes(app: FastifyInstance, {
  allowView,
  allowWriteKiosk,
  sessionService,
  operatorAccessService,
  workUnitLifecycleService
}: {
  allowView: preHandlerHookHandler;
  allowWriteKiosk: preHandlerHookHandler;
  sessionService: AssemblyWorkSessionService;
  operatorAccessService: AssemblyOperatorAccessService;
  workUnitLifecycleService: AssemblyWorkUnitLifecycleService;
}): void {
  app.post('/assembly/work-sessions/:id/operator-access', { preHandler: allowWriteKiosk }, async (request) => {
    const params = idParamSchema.parse(request.params);
    const body = operatorAccessBodySchema.parse(request.body ?? {});
    const clientDevice = await tryGetClientDevice(request.headers);
    const session = await operatorAccessService.recordResume({
      sessionId: params.id,
      operatorNfcTagUid: body.operatorNfcTagUid,
      requestId: body.requestId,
      actor: {
        clientDeviceId: clientDevice?.id ?? null,
        clientDeviceNameSnapshot: clientDevice?.name ?? null
      }
    });
    return { session: serializeSession(session, sessionService) };
  });

  app.post('/assembly/work-units/:id/invalidate', { preHandler: allowWriteKiosk }, async (request) => {
    const params = idParamSchema.parse(request.params);
    const body = invalidateAssemblyWorkUnitBodySchema.parse(request.body ?? {});
    const invalidation = await workUnitLifecycleService.invalidate({
      workUnitId: params.id,
      ...body,
      actor: await buildAssemblyTraceabilityActor(request)
    });
    return {
      invalidation: {
        id: invalidation.id,
        workUnitId: invalidation.workUnitId,
        workId: invalidation.workIdSnapshot,
        sourceState: invalidation.sourceState.toLowerCase(),
        reason: invalidation.reason,
        invalidatedAt: invalidation.invalidatedAt.toISOString()
      }
    };
  });

  app.post('/assembly/work-sessions', { preHandler: allowWriteKiosk }, async (request) => {
    const body = startSessionBodySchema.parse(request.body);
    const clientDevice = await tryGetClientDevice(request.headers);
    const session = await sessionService.start({
      ...body,
      clientDeviceId: clientDevice?.id ?? null,
      clientDeviceNameSnapshot: clientDevice?.name ?? null
    });
    return { session: serializeSession(session, sessionService) };
  });

  app.get('/assembly/work-sessions/summary', { preHandler: allowView }, async (request) => {
    const q = z
      .object({
        status: z.enum(['in_progress', 'completed', 'cancelled', 'all']).optional(),
        productNo: z.string().optional(),
        workId: z.string().optional(),
        /** 旧クライアント互換。 */
        serialNo: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(100).optional()
      })
      .parse(request.query);
    const sessions = await sessionService.listSummary(q);
    return { sessions: sessions.map(serializeSessionSummary) };
  });
}

export function registerAssemblyWorkSessionRoutes(app: FastifyInstance, {
  allowView,
  allowWriteKiosk,
  sessionService,
  traceabilityService,
  recordApprovalService,
  procedureSequenceService,
  excelService,
  businessHermesService
}: {
  allowView: preHandlerHookHandler;
  allowWriteKiosk: preHandlerHookHandler;
  sessionService: AssemblyWorkSessionService;
  traceabilityService: AssemblyTorqueTraceabilityService;
  recordApprovalService: AssemblyWorkSessionRecordApprovalService;
  procedureSequenceService: AssemblyProcedureSequenceService;
  excelService: AssemblyExcelExportService;
  businessHermesService: BusinessHermesService;
}): void {
  app.get('/assembly/work-sessions/:id/procedure-sequence', { preHandler: allowView }, async (request, reply) => {
    const params = idParamSchema.parse(request.params);
    const sequence = await procedureSequenceService.resolveForWorkSession(params.id);
    if (!sequence) return reply.status(404).send({ message: '作業セッションが見つかりません' });
    return { sequence: serializeProcedureSequence(sequence) };
  });

  app.get('/assembly/work-sessions/:id', { preHandler: allowView }, async (request, reply) => {
    const params = idParamSchema.parse(request.params);
    const session = await sessionService.getDetail(params.id);
    if (!session) return reply.status(404).send({ message: '作業セッションが見つかりません' });
    return { session: serializeSession(session, sessionService) };
  });

  app.post('/assembly/work-sessions/:id/record-torque', { preHandler: allowWriteKiosk }, async (request) => {
    const params = idParamSchema.parse(request.params);
    const agentBody = agentTorqueRecordSchema.safeParse(request.body);
    if (agentBody.success && 'sourceEventKey' in agentBody.data) {
      const { clientDevice } = await requireKioskClientDevice(request.headers['x-client-key']);
      const result = await traceabilityService.recordAgent({
        sessionId: params.id,
        clientDeviceId: clientDevice.id,
        ...agentBody.data
      });
      if (result.outcome.kind === 'recorded_ng') {
        void businessHermesService
          .recordProactiveSuggestion({
            sessionId: params.id,
            clientDeviceId: clientDevice.id,
            eventCode: 'TORQUE_NG',
            eventId: result.session.torqueRecords.at(-1)?.id
          })
          .catch(() => {
            app.log.warn({ sessionId: params.id }, 'Business Hermes proactive suggestion could not be recorded');
          });
      }
      return result;
    }
    const body = recordTorqueBodySchema.parse(request.body);
    const result = await sessionService.recordTorque({
      sessionId: params.id,
      value: body.value,
      inputSource: toPrismaTorqueInputSource(body.source),
      rawPayload: body.rawPayload ?? { source: body.source, value: body.value }
    });
    if (result.outcome.kind === 'recorded_ng') {
      const clientDevice = await tryGetClientDevice(request.headers);
      if (clientDevice) {
        void businessHermesService
          .recordProactiveSuggestion({
            sessionId: params.id,
            clientDeviceId: clientDevice.id,
            eventCode: 'TORQUE_NG',
            eventId: result.session.torqueRecords.at(-1)?.id
          })
          .catch(() => {
            app.log.warn({ sessionId: params.id }, 'Business Hermes proactive suggestion could not be recorded');
          });
      }
    }
    return { session: serializeSession(result.session, sessionService), outcome: result.outcome };
  });

  app.post('/assembly/work-sessions/:id/advance-area', { preHandler: allowWriteKiosk }, async (request) => {
    const params = idParamSchema.parse(request.params);
    const session = await sessionService.advanceArea(params.id);
    return { session: serializeSession(session, sessionService) };
  });

  app.post('/assembly/work-sessions/:id/restart-area', { preHandler: allowWriteKiosk }, async (request) => {
    const params = idParamSchema.parse(request.params);
    const body = z.object({ areaId: z.string().uuid().optional().nullable(), reason: z.string().max(500).optional().nullable() }).parse(request.body ?? {});
    const session = await sessionService.restartArea(params.id, body);
    return { session: serializeSession(session, sessionService) };
  });

  app.post('/assembly/work-sessions/:id/record-check', { preHandler: allowWriteKiosk }, async (request) => {
    const params = idParamSchema.parse(request.params);
    const body = recordCheckBodySchema.parse(request.body);
    const result = await sessionService.recordCheck({
      sessionId: params.id,
      checkItemId: body.checkItemId,
      checked: body.checked
    });
    return {
      record: serializeCheckRecord(result.record),
      checkSummary: serializeCheckSummary(result.checkSummary)
    };
  });

  app.post('/assembly/work-sessions/:id/complete', { preHandler: allowWriteKiosk }, async (request) => {
    const params = idParamSchema.parse(request.params);
    const session = await sessionService.complete(params.id);
    return { session: serializeSession(session, sessionService) };
  });

  app.post('/assembly/work-sessions/:id/record-approval/approve', { preHandler: allowWriteKiosk }, async (request) => {
    const params = idParamSchema.parse(request.params);
    const body = approveAssemblyRecordApprovalBodySchema.parse(request.body ?? {});
    const clientDevice = await tryGetClientDevice(request.headers);
    const session = await recordApprovalService.approve(params.id, {
      approverEmployeeTagUid: body.approverEmployeeTagUid,
      comment: body.comment,
      clientDeviceId: clientDevice?.id ?? null
    });
    return { session: serializeSession(session, sessionService) };
  });

  app.post('/assembly/work-sessions/:id/cancel', { preHandler: allowWriteKiosk }, async (request) => {
    const params = idParamSchema.parse(request.params);
    const body = z.object({ reason: z.string().max(500).optional().nullable() }).parse(request.body ?? {});
    const session = await sessionService.cancel(params.id, body.reason);
    return { session: serializeSession(session, sessionService) };
  });

  app.get('/assembly/work-sessions/:id/export.xlsx', { preHandler: allowView }, async (request, reply) => {
    const params = idParamSchema.parse(request.params);
    const buffer = await excelService.buildSessionWorkbookBuffer(params.id);
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('Content-Disposition', `attachment; filename="assembly-torque-${params.id}.xlsx"`);
    return reply.send(buffer);
  });
}
