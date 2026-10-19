import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  approverFindMany: vi.fn(),
  decisionCreate: vi.fn(),
  getInsights: vi.fn(),
  getPolicy: vi.fn(),
  requireEmployee: vi.fn()
}));

vi.mock('../../../../lib/prisma.js', () => ({
  prisma: {
    selfInspectionReductionApprover: { findMany: mocks.approverFindMany },
    selfInspectionLevelDecision: { create: mocks.decisionCreate }
  }
}));
vi.mock('../reduction-insights.service.js', () => ({ getSelfInspectionReductionInsights: mocks.getInsights }));
vi.mock('../reduction-policy.service.js', () => ({
  getSelfInspectionReductionPolicy: mocks.getPolicy,
  requireActiveEmployeeByTag: mocks.requireEmployee
}));

import { recordSelfInspectionLevelDecision } from '../reduction-actions.service.js';

const key = { fhincd: 'MD1', processGroup: 'CUTTING' as const, resourceCd: '581' };
const capableMetrics = {
  level: { mode: 'full', fixedCount: null },
  lotSize: 40,
  evaluable: true,
  worstCpk: 1.5,
  sampleCount: 60,
  consecutivePassLots: 12,
  consecutivePassLotsSinceChangePoint: null,
  drift: false,
  measurementGapRatio: 0.03,
  outOfToleranceCount: 0,
  nonconformityCount: 0
};

function input(cpkThreshold: 1.33 | 1.67) {
  return {
    key,
    direction: 'reduce' as const,
    periodDays: 90,
    cpkThreshold,
    approverEmployeeTagUid: '04AA',
    clientDeviceId: 'client-1'
  };
}

describe('recordSelfInspectionLevelDecision', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireEmployee.mockResolvedValue({ id: 'emp-1', employeeCode: '0412', displayName: '社員A' });
    mocks.getPolicy.mockResolvedValue({
      cpkThreshold: 1.67,
      requiredConsecutiveLots: 10,
      minimumSampleCount: 30,
      resetStreakOnChangePoint: true
    });
    mocks.getInsights.mockResolvedValue({
      parts: [{ metrics: capableMetrics, templateId: 't1', templateVersion: 2, worstItemKey: 'A|外径|外径', lotCount: 12 }]
    });
    mocks.decisionCreate.mockImplementation(async ({ data }) => ({ id: 'd1', decidedAt: new Date('2026-09-30T00:00:00Z'), ...data }));
  });

  it('refuses when no approver is configured', async () => {
    mocks.approverFindMany.mockResolvedValue([]);
    await expect(recordSelfInspectionLevelDecision(input(1.33))).rejects.toMatchObject({ statusCode: 409 });
  });

  it('refuses an employee who is not an approver', async () => {
    mocks.approverFindMany.mockResolvedValue([{ employeeId: 'emp-2' }]);
    await expect(recordSelfInspectionLevelDecision(input(1.33))).rejects.toMatchObject({ statusCode: 403 });
  });

  it('re-judges with the Cpk threshold the user saw', async () => {
    mocks.approverFindMany.mockResolvedValue([{ employeeId: 'emp-1' }]);
    await expect(recordSelfInspectionLevelDecision(input(1.67))).rejects.toMatchObject({ statusCode: 409 });
    expect(mocks.decisionCreate).not.toHaveBeenCalled();

    const decision = await recordSelfInspectionLevelDecision(input(1.33));
    expect(decision).toMatchObject({ direction: 'reduce', fromLabel: '全数', toLabel: '指定数 5', approverName: '社員A' });
    expect(mocks.decisionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        direction: 'REDUCE',
        fromMode: 'FULL',
        toMode: 'FIXED_COUNT',
        toFixedCount: 5,
        cpkThreshold: 1.33,
        approverEmployeeId: 'emp-1',
        templateIdSnapshot: 't1'
      })
    });
  });
});
