import Fastify, { type FastifyRequest, type FastifyReply, type FastifyError } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signAccessToken, signKioskAccessToken, authenticate } from '../../lib/auth.js';
import { ApiError } from '../../lib/errors.js';
import { registerAssemblyWorkSessionRoutes } from '../assembly/work-sessions.js';
import { registerSelfInspectionRoutes } from '../part-measurement/self-inspection.js';
import { registerKioskAssemblyRecordApprovalAuthRoute } from '../kiosk/assembly-record-approval-auth.js';
import { registerKioskPartMeasurementSelfInspectionRecordApprovalAuthRoute } from '../kiosk/part-measurement-self-inspection-record-approval-auth.js';
import type { User } from '@prisma/client';

const mocks = vi.hoisted(() => ({ approve: vi.fn(), verify: vi.fn(), role: 'MANAGER' }));
vi.mock('../../lib/prisma.js', () => ({ prisma: { user: { findUnique: vi.fn(async () => ({
  id: 'user', username: 'manager', role: mocks.role, status: 'ACTIVE', mfaEnabled: true
})) } } }));
vi.mock('../../services/production-schedule/production-schedule-settings.service.js', () => ({
  SHARED_DUE_MANAGEMENT_PASSWORD_LOCATION: 'shared', verifyDueManagementAccessPassword: mocks.verify
}));
vi.mock('../kiosk/shared.js', () => ({ requireClientDevice: async (key: string) => ({
  clientDevice: { id: key, name: 'terminal' }
}) }));
vi.mock('../assembly/serializers.js', () => ({ serializeSession: (session: unknown) => session }));

const id = '00000000-0000-4000-8000-000000000001';
const cases = [
  { purpose: 'assembly-record-approval' as const, approve: `/assembly/work-sessions/${id}/record-approval/approve`, verify: '/kiosk/assembly/record-approvals/verify-access-password' },
  { purpose: 'self-inspection-record-approval' as const, approve: `/part-measurement/self-inspection/sessions/${id}/record-approval/approve`, verify: '/kiosk/part-measurement/self-inspection/record-approvals/verify-access-password' }
];
let app: ReturnType<typeof Fastify>;
beforeEach(async () => {
  vi.clearAllMocks();
  mocks.approve.mockResolvedValue({ id });
  mocks.verify.mockResolvedValue({ success: true });
  app = Fastify();
  app.setErrorHandler((error: FastifyError, _request: FastifyRequest, reply: FastifyReply) => {
    void reply.code(error instanceof ApiError ? error.statusCode : 500).send({ errorCode: (error as ApiError).code, message: error.message });
  });
  const allow = async (request: FastifyRequest, reply: Parameters<typeof authenticate>[1]) => {
    if (request.headers.authorization) await authenticate(request, reply);
  };
  registerAssemblyWorkSessionRoutes(app, {
    allowView: allow, allowWriteKiosk: allow, sessionService: {},
    recordApprovalService: { approve: mocks.approve }
  } as unknown as Parameters<typeof registerAssemblyWorkSessionRoutes>[1]);
  registerSelfInspectionRoutes(app, {
    allowView: allow, allowWriteKiosk: allow, canWrite: allow,
    selfInspectionService: { approveRecordApproval: mocks.approve }
  } as unknown as Parameters<typeof registerSelfInspectionRoutes>[1]);
  const deps = { requireClientDevice: async (key: unknown) => ({ clientDevice: { id: String(key) } }) };
  await registerKioskAssemblyRecordApprovalAuthRoute(app, deps as Parameters<typeof registerKioskAssemblyRecordApprovalAuthRoute>[1]);
  await registerKioskPartMeasurementSelfInspectionRecordApprovalAuthRoute(app, deps as Parameters<typeof registerKioskPartMeasurementSelfInspectionRecordApprovalAuthRoute>[1]);
});
afterEach(async () => { await app.close(); });

describe.each(cases)('$purpose access confirmation', ({ purpose, approve, verify }) => {
  if (purpose === 'assembly-record-approval') {
    it.each(['missing', 'device', 'purpose', 'expired'] as const)('returns 403 for %s confirmation', async (kind) => {
      const accessToken = kind === 'missing' ? undefined : signKioskAccessToken(
        kind === 'purpose' ? 'due-management' : purpose,
        kind === 'device' ? 'other' : 'device', kind === 'expired' ? -1 : '12h'
      );
      const response = await app.inject({ method: 'POST', url: approve, headers: { 'x-client-key': 'device' },
        payload: { approverEmployeeTagUid: 'employee', accessToken } });
      expect(response.statusCode).toBe(403);
      const suffix = { missing: 'REQUIRED', device: 'DEVICE_MISMATCH', purpose: 'INVALID', expired: 'EXPIRED' }[kind];
      expect(response.json().errorCode).toBe(`${purpose.replaceAll('-', '_').toUpperCase()}_TOKEN_${suffix}`);
      expect(mocks.approve).not.toHaveBeenCalled();
    });
    it('returns a device-bound token and accepts it for approval', async () => {
      const verified = await app.inject({ method: 'POST', url: verify, headers: { 'x-client-key': 'device' }, payload: { password: '2520' } });
      expect(verified.statusCode).toBe(200);
      expect(verified.json()).toEqual({ success: true, token: expect.any(String) });
      const response = await app.inject({ method: 'POST', url: approve, headers: { 'x-client-key': 'device' },
        payload: { approverEmployeeTagUid: 'employee', accessToken: verified.json().token } });
      expect(response.statusCode).toBe(200);
      expect(mocks.approve).toHaveBeenCalledOnce();
    });
  } else {
    it('accepts an employee tag without password confirmation or a token', async () => {
      const response = await app.inject({ method: 'POST', url: approve, headers: { 'x-client-key': 'device' },
        payload: { approverEmployeeTagUid: 'employee' } });
      expect(response.statusCode).toBe(200);
      expect(mocks.approve).toHaveBeenCalledWith(id, expect.objectContaining({ approverEmployeeTagUid: 'employee' }));
      expect(mocks.verify).not.toHaveBeenCalled();
    });
    it('keeps the password confirmation response free of tokens', async () => {
      const response = await app.inject({ method: 'POST', url: verify, headers: { 'x-client-key': 'device' }, payload: { password: '2520' } });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ success: true });
    });
    it('preserves the same-person refusal without password confirmation', async () => {
      mocks.approve.mockRejectedValue(new ApiError(403, '同じ人は承認できません', undefined, 'RECORD_APPROVAL_SAME_PERSON'));
      const response = await app.inject({ method: 'POST', url: approve, headers: { 'x-client-key': 'device' },
        payload: { approverEmployeeTagUid: 'employee' } });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ errorCode: 'RECORD_APPROVAL_SAME_PERSON', message: '同じ人は承認できません' });
      expect(mocks.verify).not.toHaveBeenCalled();
    });
  }
  it.each(['ADMIN', 'MANAGER'] as const)('accepts a %s user JWT without an access confirmation', async (role) => {
    mocks.role = role;
    const token = signAccessToken({ id: 'user', username: 'manager', role, mfaEnabled: true } as User);
    const response = await app.inject({ method: 'POST', url: approve, headers: { authorization: `Bearer ${token}` },
      payload: { approverEmployeeTagUid: 'employee' } });
    expect(response.statusCode).toBe(200);
    expect(mocks.approve).toHaveBeenCalledOnce();
  });
  it.each(['ADMIN', 'MANAGER'] as const)('preserves the same-person refusal for a %s user JWT', async (role) => {
    mocks.role = role;
    mocks.approve.mockRejectedValue(new ApiError(403, '同じ人は承認できません', undefined, 'RECORD_APPROVAL_SAME_PERSON'));
    const token = signAccessToken({ id: 'user', username: 'manager', role, mfaEnabled: true } as User);
    const response = await app.inject({ method: 'POST', url: approve, headers: { authorization: `Bearer ${token}` },
      payload: { approverEmployeeTagUid: 'employee' } });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ errorCode: 'RECORD_APPROVAL_SAME_PERSON', message: '同じ人は承認できません' });
    expect(mocks.approve).toHaveBeenCalledWith(id, expect.objectContaining({ approverEmployeeTagUid: 'employee' }));
  });
  it('keeps an unsuccessful password response unchanged', async () => {
    mocks.verify.mockResolvedValue({ success: false });
    const response = await app.inject({ method: 'POST', url: verify, headers: { 'x-client-key': 'device' }, payload: { password: '0000' } });
    expect(response.json()).toEqual({ success: false });
  });
});
