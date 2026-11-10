import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    $transaction: vi.fn(),
    employee: { findFirst: vi.fn() },
    assemblyWorkSessionApproval: { create: vi.fn() },
    assemblyWorkSession: { findUnique: vi.fn() },
    selfInspectionSession: { findUnique: vi.fn(), updateMany: vi.fn() },
    selfInspectionMeasurementOperation: { findFirst: vi.fn() },
    selfInspectionMeasurementValue: { updateMany: vi.fn() },
    selfInspectionRecordApproval: { create: vi.fn() },
    measuringInstrumentTag: { findUnique: vi.fn() }
  },
  lockedTransaction: vi.fn()
}));
vi.mock('../../lib/prisma.js', () => ({ prisma: mocks.db }));
vi.mock('../assembly/assembly-transaction.js', () => ({
  runLockedAssemblyWorkSessionTransaction: mocks.lockedTransaction
}));
vi.mock('../part-measurement/self-inspection/mutation-guards.js', () => ({
  lockSessionRow: vi.fn(),
  assertSessionEntryCountWritable: vi.fn(),
  assertAllEntriesReviewReady: vi.fn()
}));
vi.mock('../part-measurement/self-inspection-registration-policy.service.js', () => ({
  getSelfInspectionRegistrationPolicy: vi.fn().mockResolvedValue({})
}));
vi.mock('../part-measurement/self-inspection-machine-board-cache-invalidation.js', () => ({
  resetSelfInspectionMachineBoardScheduleRowCaches: vi.fn()
}));
vi.mock('../part-measurement/self-inspection-participant-names.query.js', () => ({
  loadParticipantSummariesBySessionIds: vi.fn().mockResolvedValue(new Map())
}));
vi.mock('../part-measurement/self-inspection/serialization.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../part-measurement/self-inspection/serialization.js')>(),
  buildRecordApprovalReadiness: vi.fn().mockReturnValue({ state: 'approvable' }),
  loadPendingReviewCountsBySessionIds: vi.fn().mockResolvedValue(new Map()),
  serializeSessionSummary: vi.fn((session) => session)
}));

import { AssemblyWorkSessionRecordApprovalService } from '../assembly/assembly-work-session-record-approval.service.js';
import { SelfInspectionService } from '../part-measurement/self-inspection.service.js';

const input = { approverEmployeeTagUid: ' approver-tag ' };
const samePersonError = {
  statusCode: 403,
  code: 'RECORD_APPROVAL_SAME_PERSON',
  message: '同じ人は承認できません'
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.db.$transaction.mockImplementation(async (work) => work(mocks.db));
  mocks.db.employee.findFirst.mockResolvedValue({
    id: 'approver', employeeCode: 'E001', displayName: '承認者', nfcTagUid: 'approver-tag', status: 'ACTIVE'
  });
  mocks.db.measuringInstrumentTag.findUnique.mockResolvedValue(null);
  mocks.db.selfInspectionMeasurementOperation.findFirst.mockResolvedValue(null);
});

describe('assembly record approval', () => {
  const service = new AssemblyWorkSessionRecordApprovalService();
  const session = {
    id: 'session', status: 'COMPLETED', approval: null,
    operatorEmployeeId: 'worker', operatorAccesses: [{ employeeId: 'other-worker' }]
  };

  it.each(['operator', 'participant'])('rejects the same %s before writing approval', async (kind) => {
    const existing = {
      ...session,
      ...(kind === 'operator'
        ? { operatorEmployeeId: 'approver' }
        : { operatorAccesses: [{ employeeId: 'worker' }, { employeeId: 'approver' }] })
    };
    mocks.lockedTransaction.mockImplementation(async (_id, work) => work(mocks.db, existing));
    await expect(service.approve('session', input)).rejects.toMatchObject(samePersonError);
    expect(mocks.db.assemblyWorkSessionApproval.create).not.toHaveBeenCalled();
  });

  it('allows a different employee to approve', async () => {
    mocks.lockedTransaction.mockImplementation(async (_id, work) => work(mocks.db, session));
    mocks.db.assemblyWorkSession.findUnique.mockResolvedValue(session);
    await expect(service.approve('session', input)).resolves.toEqual(session);
    expect(mocks.db.assemblyWorkSessionApproval.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ approverEmployeeId: 'approver', sessionId: 'session' })
    });
  });
});

describe('self inspection record approval', () => {
  const service = new SelfInspectionService();
  const session = {
    id: 'session', recordApprovalRequiredAt: new Date(), completedAt: new Date(),
    recordApproval: null, invalidatedAt: null, template: {},
    entries: [{ createdByEmployeeId: 'worker' }],
    inspectorEntries: [{ inspectorEmployeeId: 'inspector' }]
  };

  it.each(['operator', 'inspector'])('rejects the same %s before writing measurement reviews or approval', async (kind) => {
    const existing = {
      ...session,
      ...(kind === 'operator'
        ? { entries: [{ createdByEmployeeId: 'worker' }, { createdByEmployeeId: 'approver' }] }
        : { inspectorEntries: [{ inspectorEmployeeId: 'inspector' }, { inspectorEmployeeId: 'approver' }] })
    };
    mocks.db.selfInspectionSession.findUnique.mockResolvedValue(existing);
    await expect(service.approveRecordApproval('session', input)).rejects.toMatchObject(samePersonError);
    expect(mocks.db.selfInspectionMeasurementValue.updateMany).not.toHaveBeenCalled();
    expect(mocks.db.selfInspectionRecordApproval.create).not.toHaveBeenCalled();
    expect(mocks.db.selfInspectionSession.updateMany).not.toHaveBeenCalled();
  });

  it('rejects employee B who updated a record created by employee A', async () => {
    mocks.db.selfInspectionSession.findUnique.mockResolvedValue(session);
    mocks.db.selfInspectionMeasurementOperation.findFirst.mockResolvedValue({ id: 'update-by-B' });
    await expect(service.approveRecordApproval('session', input)).rejects.toMatchObject(samePersonError);
    expect(mocks.db.selfInspectionMeasurementOperation.findFirst).toHaveBeenCalledExactlyOnceWith({
      where: { sessionId: 'session', authentication: { employeeId: 'approver' } }, select: { id: true }
    });
    expect(mocks.db.selfInspectionRecordApproval.create).not.toHaveBeenCalled();
    expect(mocks.db.selfInspectionMeasurementValue.updateMany).not.toHaveBeenCalled();
  });

  it('allows employee C to approve a record created and operated by employee A', async () => {
    mocks.db.selfInspectionSession.findUnique.mockResolvedValue(session);
    await expect(service.approveRecordApproval('session', input)).resolves.toEqual(session);
    expect(mocks.db.selfInspectionMeasurementOperation.findFirst).toHaveBeenCalledExactlyOnceWith({
      where: { sessionId: 'session', authentication: { employeeId: 'approver' } }, select: { id: true }
    });
    expect(mocks.db.selfInspectionRecordApproval.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ approverEmployeeId: 'approver', sessionId: 'session' })
    });
  });
});
