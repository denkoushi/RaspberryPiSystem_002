import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';

const mocks = vi.hoisted(() => ({
  requireAccessPassword: vi.fn(),
  getInsights: vi.fn(),
  updatePolicy: vi.fn(),
  listApprovers: vi.fn(),
  getPolicy: vi.fn(),
  addApprover: vi.fn(),
  removeApprover: vi.fn(),
  recordChangePoint: vi.fn(),
  recordDecision: vi.fn()
}));

vi.mock('../../../services/part-measurement/self-inspection-registration-policy-access.service.js', () => ({
  SelfInspectionRegistrationPolicyAccessService: class {
    requireAccessPassword = mocks.requireAccessPassword;
  }
}));
vi.mock('../../../services/part-measurement/self-inspection-reduction/reduction-insights.service.js', () => ({
  SELF_INSPECTION_REDUCTION_PERIOD_DAYS: [30, 90, 180],
  getSelfInspectionReductionInsights: mocks.getInsights
}));
vi.mock('../../../services/part-measurement/self-inspection-reduction/reduction-policy.service.js', () => ({
  getSelfInspectionReductionPolicy: mocks.getPolicy,
  updateSelfInspectionReductionPolicy: mocks.updatePolicy,
  listSelfInspectionReductionApprovers: mocks.listApprovers,
  addSelfInspectionReductionApprover: mocks.addApprover,
  removeSelfInspectionReductionApprover: mocks.removeApprover
}));
vi.mock('../../../services/part-measurement/self-inspection-reduction/reduction-actions.service.js', () => ({
  recordSelfInspectionChangePoint: mocks.recordChangePoint,
  recordSelfInspectionLevelDecision: mocks.recordDecision
}));
vi.mock('../shared.js', () => ({ tryGetClientDeviceId: vi.fn().mockResolvedValue('client-1') }));

import { registerSelfInspectionReductionRoutes } from '../self-inspection-reduction.js';

async function createApp() {
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    const status = error instanceof ZodError ? 400 : ((error as { statusCode?: number }).statusCode ?? 500);
    void reply.code(status).send({ message: error.message });
  });
  const allow = vi.fn(async () => undefined);
  registerSelfInspectionReductionRoutes(app, { allowView: allow, allowWriteKiosk: allow } as never);
  await app.ready();
  return app;
}

describe('self-inspection reduction routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listApprovers.mockResolvedValue([]);
  });

  it('reads insights for an allowed period only', async () => {
    mocks.getInsights.mockResolvedValue({ periodDays: 30, parts: [] });
    const app = await createApp();
    try {
      expect((await app.inject({ method: 'GET', url: '/part-measurement/self-inspection/reduction/insights?periodDays=30' })).statusCode).toBe(200);
      expect(mocks.getInsights).toHaveBeenCalledWith({ periodDays: 30 });
      expect((await app.inject({ method: 'GET', url: '/part-measurement/self-inspection/reduction/insights?periodDays=45' })).statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('requires the operation password before saving the policy from a kiosk', async () => {
    mocks.requireAccessPassword.mockRejectedValueOnce(Object.assign(new Error('bad'), { statusCode: 403 }));
    const app = await createApp();
    const payload = {
      cpkThreshold: 1.33,
      requiredConsecutiveLots: 8,
      minimumSampleCount: 25,
      resetStreakOnChangePoint: false,
      accessPassword: 'wrong'
    };
    try {
      const denied = await app.inject({ method: 'PUT', url: '/part-measurement/self-inspection/reduction/policy', payload });
      expect(denied.statusCode).toBe(403);
      expect(mocks.updatePolicy).not.toHaveBeenCalled();

      mocks.updatePolicy.mockResolvedValue({ ...payload, accessPassword: undefined });
      const saved = await app.inject({ method: 'PUT', url: '/part-measurement/self-inspection/reduction/policy', payload });
      expect(saved.statusCode).toBe(200);
      expect(mocks.updatePolicy).toHaveBeenCalledWith(
        { cpkThreshold: 1.33, requiredConsecutiveLots: 8, minimumSampleCount: 25, resetStreakOnChangePoint: false },
        'client-1'
      );
    } finally {
      await app.close();
    }
  });

  it('rejects a Cpk threshold other than 1.33 or 1.67', async () => {
    const app = await createApp();
    try {
      const response = await app.inject({
        method: 'PUT',
        url: '/part-measurement/self-inspection/reduction/policy',
        payload: { cpkThreshold: 1.5, requiredConsecutiveLots: 10, minimumSampleCount: 30, resetStreakOnChangePoint: true }
      });
      expect(response.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('forwards an approval with the part key in database terms', async () => {
    mocks.recordDecision.mockResolvedValue({ id: 'd1' });
    const app = await createApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/part-measurement/self-inspection/reduction/decisions',
        payload: {
          fhincd: 'MD00412163',
          processGroup: 'grinding',
          resourceCd: '612',
          direction: 'reduce',
          periodDays: 90,
          cpkThreshold: 1.67,
          approverEmployeeTagUid: '04AABB'
        }
      });
      expect(response.statusCode).toBe(200);
      expect(mocks.recordDecision).toHaveBeenCalledWith({
        key: { fhincd: 'MD00412163', processGroup: 'GRINDING', resourceCd: '612' },
        direction: 'reduce',
        periodDays: 90,
        cpkThreshold: 1.67,
        approverEmployeeTagUid: '04AABB',
        clientDeviceId: 'client-1'
      });
    } finally {
      await app.close();
    }
  });

  it('records a change point with the reading employee tag', async () => {
    mocks.recordChangePoint.mockResolvedValue({ id: 'cp1' });
    const app = await createApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/part-measurement/self-inspection/reduction/change-points',
        payload: { fhincd: 'MD1', processGroup: 'cutting', resourceCd: '581', kind: 'TOOL_CHANGE', employeeTagUid: '04CC' }
      });
      expect(response.statusCode).toBe(200);
      expect(mocks.recordChangePoint).toHaveBeenCalledWith({
        key: { fhincd: 'MD1', processGroup: 'CUTTING', resourceCd: '581' },
        kind: 'TOOL_CHANGE',
        employeeTagUid: '04CC',
        clientDeviceId: 'client-1'
      });
    } finally {
      await app.close();
    }
  });
});
