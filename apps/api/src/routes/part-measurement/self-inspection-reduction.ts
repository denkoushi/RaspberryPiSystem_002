import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  SELF_INSPECTION_REDUCTION_CONSECUTIVE_LOTS_RANGE,
  SELF_INSPECTION_REDUCTION_MINIMUM_SAMPLE_RANGE,
  isSelfInspectionReductionCpkThreshold,
  type SelfInspectionReductionCpkThreshold
} from '@raspi-system/shared-types';
import { z } from 'zod';

import { SelfInspectionRegistrationPolicyAccessService } from '../../services/part-measurement/self-inspection-registration-policy-access.service.js';
import {
  recordSelfInspectionChangePoint,
  recordSelfInspectionLevelDecision
} from '../../services/part-measurement/self-inspection-reduction/reduction-actions.service.js';
import {
  SELF_INSPECTION_REDUCTION_PERIOD_DAYS,
  getSelfInspectionReductionInsights
} from '../../services/part-measurement/self-inspection-reduction/reduction-insights.service.js';
import {
  addSelfInspectionReductionApprover,
  getSelfInspectionReductionPolicy,
  listSelfInspectionReductionApprovers,
  removeSelfInspectionReductionApprover,
  updateSelfInspectionReductionPolicy
} from '../../services/part-measurement/self-inspection-reduction/reduction-policy.service.js';

import { tryGetClientDeviceId, type PartMeasurementRouteDeps } from './shared.js';

const BASE = '/part-measurement/self-inspection/reduction';

// 設定変更と NFC を伴う記録は総当たりを防ぎつつ、キオスクの再タッチを許容する。
const reductionSettingsRateLimit = { max: 10, timeWindow: '1 minute' };
const reductionTagRateLimit = { max: 20, timeWindow: '1 minute' };

const periodDaysSchema = z.coerce
  .number()
  .int()
  .refine((value) => (SELF_INSPECTION_REDUCTION_PERIOD_DAYS as readonly number[]).includes(value), {
    message: '期間は30・90・180日から選んでください'
  });

const cpkThresholdSchema = z.coerce
  .number()
  .refine(isSelfInspectionReductionCpkThreshold, { message: 'Cpk基準は1.33か1.67です' })
  .transform((value) => value as SelfInspectionReductionCpkThreshold);

const partKeySchema = z.object({
  fhincd: z.string().trim().min(1).max(120),
  processGroup: z.enum(['cutting', 'grinding']),
  resourceCd: z.string().trim().min(1).max(40)
});

const tagUidSchema = z.string().trim().min(1).max(128);
const accessPasswordSchema = z.string().max(256).optional();

const insightsQuerySchema = z.object({ periodDays: periodDaysSchema.default(90) });

const policyBodySchema = z.object({
  cpkThreshold: cpkThresholdSchema,
  requiredConsecutiveLots: z.coerce
    .number()
    .int()
    .min(SELF_INSPECTION_REDUCTION_CONSECUTIVE_LOTS_RANGE.min)
    .max(SELF_INSPECTION_REDUCTION_CONSECUTIVE_LOTS_RANGE.max),
  minimumSampleCount: z.coerce
    .number()
    .int()
    .min(SELF_INSPECTION_REDUCTION_MINIMUM_SAMPLE_RANGE.min)
    .max(SELF_INSPECTION_REDUCTION_MINIMUM_SAMPLE_RANGE.max),
  resetStreakOnChangePoint: z.boolean(),
  accessPassword: accessPasswordSchema
});

const addApproverBodySchema = z.object({ employeeTagUid: tagUidSchema, accessPassword: accessPasswordSchema });
const removeApproverBodySchema = z.object({ accessPassword: accessPasswordSchema });
const approverIdParamsSchema = z.object({ id: z.string().uuid() });

const changePointBodySchema = partKeySchema.extend({
  kind: z.enum(['TOOL_CHANGE', 'SETUP_CHANGE', 'MATERIAL_LOT', 'MACHINE_REPAIR', 'PROGRAM_CHANGE', 'OTHER']),
  employeeTagUid: tagUidSchema
});

const decisionBodySchema = partKeySchema.extend({
  direction: z.enum(['reduce', 'restore']),
  periodDays: periodDaysSchema,
  cpkThreshold: cpkThresholdSchema,
  approverEmployeeTagUid: tagUidSchema
});

function toKey(body: z.infer<typeof partKeySchema>) {
  return {
    fhincd: body.fhincd,
    processGroup: body.processGroup === 'grinding' ? ('GRINDING' as const) : ('CUTTING' as const),
    resourceCd: body.resourceCd
  };
}

export function registerSelfInspectionReductionRoutes(app: FastifyInstance, deps: PartMeasurementRouteDeps): void {
  const { allowView, allowWriteKiosk } = deps;
  const accessService = new SelfInspectionRegistrationPolicyAccessService();

  /** 管理者ログイン時はパスワード不要。キオスクからは共有の操作時パスワードを求める。 */
  async function requireSettingsAccess(request: FastifyRequest, password: string | undefined): Promise<string> {
    if (request.user) return request.user.username;
    await accessService.requireAccessPassword(password);
    return (await tryGetClientDeviceId(request.headers)) ?? 'kiosk';
  }

  app.get(`${BASE}/insights`, { preHandler: allowView }, async (request) => {
    const query = insightsQuerySchema.parse(request.query);
    return getSelfInspectionReductionInsights({ periodDays: query.periodDays });
  });

  app.get(`${BASE}/policy`, { preHandler: allowView }, async () => ({
    policy: await getSelfInspectionReductionPolicy(),
    approvers: await listSelfInspectionReductionApprovers()
  }));

  app.put(
    `${BASE}/policy`,
    { preHandler: allowWriteKiosk, config: { rateLimit: reductionSettingsRateLimit } },
    async (request) => {
      const body = policyBodySchema.parse(request.body);
      const updatedBy = await requireSettingsAccess(request, body.accessPassword);
      const policy = await updateSelfInspectionReductionPolicy(
        {
          cpkThreshold: body.cpkThreshold,
          requiredConsecutiveLots: body.requiredConsecutiveLots,
          minimumSampleCount: body.minimumSampleCount,
          resetStreakOnChangePoint: body.resetStreakOnChangePoint
        },
        updatedBy
      );
      return { policy, approvers: await listSelfInspectionReductionApprovers() };
    }
  );

  app.post(
    `${BASE}/approvers`,
    { preHandler: allowWriteKiosk, config: { rateLimit: reductionSettingsRateLimit } },
    async (request) => {
      const body = addApproverBodySchema.parse(request.body);
      const addedBy = await requireSettingsAccess(request, body.accessPassword);
      return { approvers: await addSelfInspectionReductionApprover(body.employeeTagUid, addedBy) };
    }
  );

  app.post(
    `${BASE}/approvers/:id/remove`,
    { preHandler: allowWriteKiosk, config: { rateLimit: reductionSettingsRateLimit } },
    async (request) => {
      const params = approverIdParamsSchema.parse(request.params);
      const body = removeApproverBodySchema.parse(request.body ?? {});
      await requireSettingsAccess(request, body.accessPassword);
      return { approvers: await removeSelfInspectionReductionApprover(params.id) };
    }
  );

  app.post(
    `${BASE}/change-points`,
    { preHandler: allowWriteKiosk, config: { rateLimit: reductionTagRateLimit } },
    async (request) => {
      const body = changePointBodySchema.parse(request.body);
      const changePoint = await recordSelfInspectionChangePoint({
        key: toKey(body),
        kind: body.kind,
        employeeTagUid: body.employeeTagUid,
        clientDeviceId: (await tryGetClientDeviceId(request.headers)) ?? null
      });
      return { changePoint };
    }
  );

  app.post(
    `${BASE}/decisions`,
    { preHandler: allowWriteKiosk, config: { rateLimit: reductionTagRateLimit } },
    async (request) => {
      const body = decisionBodySchema.parse(request.body);
      const decision = await recordSelfInspectionLevelDecision({
        key: toKey(body),
        direction: body.direction,
        periodDays: body.periodDays,
        cpkThreshold: body.cpkThreshold,
        approverEmployeeTagUid: body.approverEmployeeTagUid,
        clientDeviceId: (await tryGetClientDeviceId(request.headers)) ?? null
      });
      return { decision };
    }
  );
}
