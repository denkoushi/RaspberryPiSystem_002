import type { FastifyInstance } from 'fastify';
import { z } from 'zod';








import { resolveSelfInspectionNfcTagUid } from '../../services/part-measurement/self-inspection-nfc-tag-resolve.js';
import {
  getSelfInspectionRegistrationPolicy,
  updateSelfInspectionRegistrationPolicy
} from '../../services/part-measurement/self-inspection-registration-policy.service.js';




import {
  selfInspectionSessionResolveBodySchema,
  listSelfInspectionSessionsQuerySchema,
  getSelfInspectionSessionQuerySchema,
  selfInspectionSessionIdParamsSchema,
  selfInspectionEntryIdParamsSchema,
  selfInspectionEntryIndexParamsSchema,
  selfInspectionCreateEntryBodySchema,
  selfInspectionUpdateEntryBodySchema,
  selfInspectionCreateInspectorEntryBodySchema,
  selfInspectionUpdateInspectorEntryBodySchema,
  selfInspectionInstrumentPreUseInspectionBodySchema,
  selfInspectionResetSessionBodySchema,
  approveSelfInspectionOutOfToleranceReviewBodySchema,
  listSelfInspectionRecordApprovalsQuerySchema,
  resolveSelfInspectionRecordApprovalApproverBodySchema,
  approveSelfInspectionRecordApprovalBodySchema,
  selfInspectionRegistrationPolicyBodySchema,
  issueSelfInspectionPaperReportBodySchema,
  selfInspectionPaperReportIdParamsSchema,
  selfInspectionPaperOcrReviewIdParamsSchema,
  selfInspectionPaperQrPayloadBodySchema,
  createSelfInspectionPaperOcrReviewBodySchema,
  confirmSelfInspectionPaperOcrReviewBodySchema,
  serializeTemplate,
  serializeSelfInspectionPaperReportPage,
  serializeSelfInspectionPaperReport,
  serializeSelfInspectionPaperReportForPrint,
  serializeSelfInspectionPaperOcrReview,
  serializeSelfInspectionRegistrationPolicy,
  tryGetClientDeviceId,
  type PartMeasurementRouteDeps
} from './shared.js';

export function registerSelfInspectionRoutes(app: FastifyInstance, deps: PartMeasurementRouteDeps): void {
  const {
    allowView,
    allowWriteKiosk,
    canWrite,
    selfInspectionService,
    paperReportIssueService,
    paperReportResolver,
    paperOcrReviewService,
    paperImportService
  } = deps;

    app.post('/part-measurement/self-inspection/nfc-tags/resolve', { preHandler: allowView }, async (request) => {
      const body = z.object({ uid: z.string().min(1).max(200) }).parse(request.body);
      const result = await resolveSelfInspectionNfcTagUid(body.uid);
      return { result };
    });

    app.get('/part-measurement/self-inspection/registration-policy', { preHandler: allowView }, async () => {
      const policy = await getSelfInspectionRegistrationPolicy();
      return { policy: serializeSelfInspectionRegistrationPolicy(policy) };
    });

    app.put('/part-measurement/self-inspection/registration-policy', { preHandler: allowWriteKiosk }, async (request) => {
      const body = selfInspectionRegistrationPolicyBodySchema.parse(request.body);
      const clientDeviceId = request.user ? undefined : await tryGetClientDeviceId(request.headers);
      const policy = await updateSelfInspectionRegistrationPolicy({
        requireMeasuringInstrumentTag: body.requireMeasuringInstrumentTag,
        updatedBy: request.user?.username ?? clientDeviceId ?? 'kiosk'
      });
      return { policy: serializeSelfInspectionRegistrationPolicy(policy) };
    });

    app.post('/part-measurement/self-inspection/sessions/resolve-or-create', { preHandler: allowWriteKiosk }, async (request) => {
      const body = selfInspectionSessionResolveBodySchema.parse(request.body);
      const clientDeviceId = await tryGetClientDeviceId(request.headers);
      const session = await selfInspectionService.resolveOrCreateSession({
        templateId: body.templateId,
        productNo: body.productNo,
        processGroup: body.processGroup === 'grinding' ? 'GRINDING' : 'CUTTING',
        resourceCd: body.resourceCd,
        scheduleRowId: body.scheduleRowId,
        fseiban: body.fseiban,
        fhincd: body.fhincd,
        fhinmei: body.fhinmei,
        machineName: body.machineName,
        clientDeviceId
      });
      return { session };
    });

    app.get('/part-measurement/self-inspection/sessions', { preHandler: allowView }, async (request) => {
      const query = listSelfInspectionSessionsQuerySchema.parse(request.query);
      return selfInspectionService.listSessions({
        productNo: query.productNo,
        resourceCd: query.resourceCd,
        processGroup: query.processGroup ? (query.processGroup === 'grinding' ? 'GRINDING' : 'CUTTING') : undefined,
        status: query.status
      });
    });

    app.get('/part-measurement/self-inspection/record-approvals', { preHandler: allowView }, async (request) => {
      const query = listSelfInspectionRecordApprovalsQuerySchema.parse(request.query);
      return selfInspectionService.listRecordApprovalSessions({
        productNo: query.productNo,
        resourceCd: query.resourceCd,
        processGroup: query.processGroup ? (query.processGroup === 'grinding' ? 'GRINDING' : 'CUTTING') : undefined,
        state: query.state
      });
    });

    app.get('/part-measurement/self-inspection/record-approvals/sessions/:id', { preHandler: allowView }, async (request) => {
      const params = selfInspectionSessionIdParamsSchema.parse(request.params);
      return { session: await selfInspectionService.getRecordApprovalSessionDetail(params.id) };
    });

    app.post('/part-measurement/self-inspection/record-approvals/approver/resolve', { preHandler: allowView }, async (request) => {
      const body = resolveSelfInspectionRecordApprovalApproverBodySchema.parse(request.body);
      return { result: await selfInspectionService.resolveRecordApprovalApprover(body.uid) };
    });

    app.get(
      '/part-measurement/self-inspection/out-of-tolerance-reviews',
      { preHandler: canWrite },
      async () => selfInspectionService.listPendingOutOfToleranceReviews()
    );

    app.get(
      '/part-measurement/self-inspection/sessions/:id/inspector-measurements',
      { preHandler: allowView },
      async (request) => {
        const params = selfInspectionSessionIdParamsSchema.parse(request.params);
        const query = getSelfInspectionSessionQuerySchema.parse(request.query ?? {});
        const session = await selfInspectionService.getInspectorMeasurementSessionDetail(params.id, {
          entryIndex: query.entryIndex
        });
        return {
          session: {
            ...session,
            template: serializeTemplate({
              ...session.template,
              visualTemplateId: session.template.visualTemplateId,
              visualTemplate: session.template.visualTemplate,
              items: session.template.items
            })
          }
        };
      }
    );

    app.get('/part-measurement/self-inspection/sessions/:id', { preHandler: allowView }, async (request) => {
      const params = selfInspectionSessionIdParamsSchema.parse(request.params);
      const query = getSelfInspectionSessionQuerySchema.parse(request.query ?? {});
      const session = await selfInspectionService.getSessionDetail(params.id, {
        entryIndex: query.entryIndex
      });
      return {
        session: {
          ...session,
          template: serializeTemplate({
            ...session.template,
            visualTemplateId: session.template.visualTemplateId,
            visualTemplate: session.template.visualTemplate,
            items: session.template.items
          })
        }
      };
    });

    app.post('/part-measurement/self-inspection/sessions/:id/entries', { preHandler: allowWriteKiosk }, async (request) => {
      const params = selfInspectionSessionIdParamsSchema.parse(request.params);
      const body = selfInspectionCreateEntryBodySchema.parse(request.body);
      const entry = await selfInspectionService.createEntry(params.id, {
        entryIndex: body.entryIndex,
        employeeTagUid: body.employeeTagUid,
        measuringInstrumentTagUid: body.measuringInstrumentTagUid,
        values: body.values
      });
      return { entry };
    });

    app.post('/part-measurement/self-inspection/sessions/:id/inspector-entries', { preHandler: allowWriteKiosk }, async (request) => {
      const params = selfInspectionSessionIdParamsSchema.parse(request.params);
      const body = selfInspectionCreateInspectorEntryBodySchema.parse(request.body);
      const clientDeviceId = await tryGetClientDeviceId(request.headers);
      const entry = await selfInspectionService.createInspectorEntry(params.id, {
        entryIndex: body.entryIndex,
        employeeTagUid: body.employeeTagUid,
        measuringInstrumentTagUid: body.measuringInstrumentTagUid,
        values: body.values,
        clientDeviceId
      });
      return { entry };
    });

    app.patch('/part-measurement/self-inspection/sessions/:id/inspector-entries/:entryId', { preHandler: allowWriteKiosk }, async (request) => {
      const params = selfInspectionEntryIdParamsSchema.parse(request.params);
      const body = selfInspectionUpdateInspectorEntryBodySchema.parse(request.body);
      const clientDeviceId = await tryGetClientDeviceId(request.headers);
      const entry = await selfInspectionService.updateInspectorEntry(params.id, params.entryId, {
        entryIndex: body.entryIndex,
        ifUnmodifiedSince: body.ifUnmodifiedSince,
        employeeTagUid: body.employeeTagUid,
        measuringInstrumentTagUid: body.measuringInstrumentTagUid,
        values: body.values,
        clientDeviceId
      });
      return { entry };
    });

    app.patch('/part-measurement/self-inspection/sessions/:id/entries/:entryId', { preHandler: allowWriteKiosk }, async (request) => {
      const params = selfInspectionEntryIdParamsSchema.parse(request.params);
      const body = selfInspectionUpdateEntryBodySchema.parse(request.body);
      const entry = await selfInspectionService.updateEntry(params.id, params.entryId, {
        ifUnmodifiedSince: body.ifUnmodifiedSince,
        employeeTagUid: body.employeeTagUid,
        measuringInstrumentTagUid: body.measuringInstrumentTagUid,
        values: body.values
      });
      return { entry };
    });

    app.post(
      '/part-measurement/self-inspection/sessions/:id/entries/:entryIndex/instrument-usages/pre-use-inspection',
      { preHandler: allowWriteKiosk },
      async (request) => {
        const params = selfInspectionEntryIndexParamsSchema.parse(request.params);
        const body = selfInspectionInstrumentPreUseInspectionBodySchema.parse(request.body);
        const clientDeviceId = await tryGetClientDeviceId(request.headers);
        return selfInspectionService.recordInstrumentPreUseInspection(params.id, params.entryIndex, {
          instrumentTagUid: body.instrumentTagUid,
          employeeTagUid: body.employeeTagUid,
          clientDeviceId
        });
      }
    );

    app.post(
      '/part-measurement/self-inspection/sessions/:id/inspector-entries/:entryIndex/instrument-usages/pre-use-inspection',
      { preHandler: allowWriteKiosk },
      async (request) => {
        const params = selfInspectionEntryIndexParamsSchema.parse(request.params);
        const body = selfInspectionInstrumentPreUseInspectionBodySchema.parse(request.body);
        const clientDeviceId = await tryGetClientDeviceId(request.headers);
        return selfInspectionService.recordInspectorInstrumentPreUseInspection(params.id, params.entryIndex, {
          instrumentTagUid: body.instrumentTagUid,
          employeeTagUid: body.employeeTagUid,
          clientDeviceId
        });
      }
    );

    app.post('/part-measurement/self-inspection/sessions/:id/complete', { preHandler: allowWriteKiosk }, async (request) => {
      const params = selfInspectionSessionIdParamsSchema.parse(request.params);
      const session = await selfInspectionService.completeSession(params.id);
      return { session };
    });

    app.post(
      '/part-measurement/self-inspection/sessions/:id/out-of-tolerance-review/approve',
      { preHandler: canWrite },
      async (request) => {
        const params = selfInspectionSessionIdParamsSchema.parse(request.params);
        const body = approveSelfInspectionOutOfToleranceReviewBodySchema.parse(request.body ?? {});
        const session = await selfInspectionService.approveOutOfToleranceReview(params.id, {
          comment: body.comment,
          actorUserId: request.user!.id,
          actorUsername: request.user!.username
        });
        return { session };
      }
    );

    app.post(
      '/part-measurement/self-inspection/sessions/:id/record-approval/approve',
      { preHandler: allowWriteKiosk },
      async (request) => {
        const params = selfInspectionSessionIdParamsSchema.parse(request.params);
        const body = approveSelfInspectionRecordApprovalBodySchema.parse(request.body ?? {});
        const clientDeviceId = await tryGetClientDeviceId(request.headers);
        const session = await selfInspectionService.approveRecordApproval(params.id, {
          approverEmployeeTagUid: body.approverEmployeeTagUid,
          comment: body.comment,
          clientDeviceId
        });
        return { session };
      }
    );

    app.post('/part-measurement/self-inspection/sessions/:id/reset', { preHandler: allowWriteKiosk }, async (request) => {
      const params = selfInspectionSessionIdParamsSchema.parse(request.params);
      const body = selfInspectionResetSessionBodySchema.parse(request.body);
      const clientDeviceId = await tryGetClientDeviceId(request.headers);
      const authMode = request.user ? 'bearer' : 'client_key';
      const result = await selfInspectionService.resetSession(params.id, {
        confirmDestructiveReset: body.confirmDestructiveReset,
        confirmCompletedSessionReset: body.confirmCompletedSessionReset,
        requestId: body.requestId,
        reason: body.reason,
        clientDeviceId,
        actorUserId: request.user?.id,
        actorUsername: request.user?.username,
        authMode
      });
      return result;
    });

    app.post(
      '/part-measurement/self-inspection/paper-reports/issue',
      { preHandler: allowWriteKiosk },
      async (request) => {
        const body = issueSelfInspectionPaperReportBodySchema.parse(request.body);
        const clientDeviceId = await tryGetClientDeviceId(request.headers);
        const report = await paperReportIssueService.issue({
          ...body,
          clientDeviceId
        });
        return serializeSelfInspectionPaperReportForPrint(report);
      }
    );

    app.get(
      '/part-measurement/self-inspection/paper-reports/:id/print',
      { preHandler: allowView },
      async (request) => {
        const params = selfInspectionPaperReportIdParamsSchema.parse(request.params);
        const report = await paperReportIssueService.getPrintReport(params.id);
        return serializeSelfInspectionPaperReportForPrint(report);
      }
    );

    app.post(
      '/part-measurement/self-inspection/paper-reports/resolve-page',
      { preHandler: allowView },
      async (request) => {
        const body = selfInspectionPaperQrPayloadBodySchema.parse(request.body);
        const resolved = await paperReportResolver.resolvePageQr(body.qrPayload);
        if (!resolved.valid) {
          return resolved;
        }
        return {
          valid: true,
          page: serializeSelfInspectionPaperReportPage(resolved.page),
          report: serializeSelfInspectionPaperReport(resolved.page.report)
        };
      }
    );

    app.post(
      '/part-measurement/self-inspection/paper-reports/ocr-reviews',
      { preHandler: allowWriteKiosk },
      async (request) => {
        const body = createSelfInspectionPaperOcrReviewBodySchema.parse(request.body);
        const result = await paperOcrReviewService.createReview({
          qrPayload: body.qrPayload,
          candidateValues: body.candidateValues,
          imageStoragePath: body.imageStoragePath
        });
        return {
          review: serializeSelfInspectionPaperOcrReview(result.review),
          page: serializeSelfInspectionPaperReportPage(result.page),
          report: serializeSelfInspectionPaperReport(result.page.report)
        };
      }
    );

    app.post(
      '/part-measurement/self-inspection/paper-reports/ocr-reviews/:id/confirm',
      { preHandler: allowWriteKiosk },
      async (request) => {
        const params = selfInspectionPaperOcrReviewIdParamsSchema.parse(request.params);
        const body = confirmSelfInspectionPaperOcrReviewBodySchema.parse(request.body);
        const result = await paperImportService.confirmReview(params.id, {
          values: body.values,
          employeeTagUid: body.employeeTagUid,
          measuringInstrumentTagUid: body.measuringInstrumentTagUid,
          confirmedByActorId: body.confirmedByActorId ?? request.user?.id ?? null,
          confirmedByActorName: body.confirmedByActorName ?? request.user?.username ?? null
        });
        return {
          review: serializeSelfInspectionPaperOcrReview(result.review),
          report: serializeSelfInspectionPaperReport(result.report)
        };
      }
    );
}
