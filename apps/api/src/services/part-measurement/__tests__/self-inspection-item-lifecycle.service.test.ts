import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const session = {
    id: 'session-1',
    sessionBusinessKey: 'PO-1::CUTTING::R1::row-1',
    templateId: 'template-actual-r2',
    productNo: 'PO-1',
    processGroup: 'CUTTING',
    scheduleResourceCd: 'R1',
    resourceCd: 'R2',
    scheduleRowId: 'row-1',
    fseiban: 'FS-1',
    fhincd: 'PART-1',
    fhinmei: '品名',
    machineName: null,
    plannedQuantity: 1,
    expectedEntryCount: 1,
    invalidatedAt: null,
    completedAt: null,
    recordApprovalRequiredAt: null,
    inspectorRemeasurementRequiredAt: null,
    entries: [],
    recordApproval: null,
    template: {
      siblingGroupId: 'group-1',
      fhincd: 'PART-1',
      processGroup: 'CUTTING',
      fkojun: '10'
    }
  };
  const tx = {
    selfInspectionSession: { findUnique: vi.fn(), update: vi.fn() },
    selfInspectionItemInvalidation: { findUnique: vi.fn(), create: vi.fn() },
    selfInspectionPaperReport: { updateMany: vi.fn() },
    partMeasurementTemplate: { findUnique: vi.fn() }
  };
  return {
    session,
    tx,
    prisma: {
      $transaction: vi.fn(async (callback: (tx: typeof tx) => unknown) => callback(tx)),
      selfInspectionItemInvalidation: { findUnique: vi.fn() }
    }
  };
});

vi.mock('../../../lib/prisma.js', () => ({ prisma: mocks.prisma }));
vi.mock('../self-inspection-item-lock.repository.js', () => ({
  lockSelfInspectionItemBusinessKey: vi.fn()
}));
vi.mock('../self-inspection/mutation-guards.js', () => ({ lockSessionRow: vi.fn() }));
vi.mock('../self-inspection-machine-board-cache-invalidation.js', () => ({
  resetSelfInspectionMachineBoardScheduleRowCaches: vi.fn()
}));

import { SelfInspectionItemLifecycleService } from '../self-inspection-item-lifecycle.service.js';

describe('SelfInspectionItemLifecycleService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.selfInspectionItemInvalidation.findUnique.mockResolvedValue(null);
    mocks.tx.selfInspectionSession.findUnique.mockResolvedValue(mocks.session);
    mocks.tx.selfInspectionSession.update.mockResolvedValue(undefined);
    mocks.tx.selfInspectionItemInvalidation.findUnique.mockResolvedValue(null);
    mocks.tx.selfInspectionPaperReport.updateMany.mockResolvedValue({ count: 0 });
    mocks.tx.partMeasurementTemplate.findUnique.mockResolvedValue({
      siblingGroupId: 'group-1',
      fhincd: 'PART-1',
      processGroup: 'CUTTING',
      fkojun: '10',
      resourceCd: 'R1',
      templateScope: 'THREE_KEY'
    });
    mocks.tx.selfInspectionItemInvalidation.create.mockImplementation(async ({ data }) => data);
  });

  it('accepts a schedule-row target for a session using a selected sibling resource', async () => {
    const service = new SelfInspectionItemLifecycleService({
      requireAccessPassword: vi.fn().mockResolvedValue(undefined)
    } as never);

    const invalidation = await service.invalidate({
      target: {
        kind: 'schedule_row',
        scheduleRowId: 'row-1',
        templateId: 'template-planned-r1',
        productNo: 'PO-1',
        processGroup: 'CUTTING',
        resourceCd: 'R1',
        fseiban: 'FS-1',
        fhincd: 'PART-1',
        fhinmei: '品名'
      },
      requestId: 'request-1',
      accessPassword: '2520',
      reason: '対象外',
      actor: { username: null, clientDeviceId: null, clientDeviceNameSnapshot: null }
    });

    expect(mocks.tx.partMeasurementTemplate.findUnique).toHaveBeenCalledWith({
      where: { id: 'template-planned-r1' },
      select: expect.objectContaining({ siblingGroupId: true, fkojun: true, resourceCd: true })
    });
    expect(invalidation).toMatchObject({
      itemBusinessKey: 'PO-1::CUTTING::R1::row-1',
      sessionId: 'session-1',
      templateIdSnapshot: 'template-actual-r2',
      resourceCdSnapshot: 'R2'
    });
  });

  it('rejects a schedule-row template outside the selected resource sibling group', async () => {
    mocks.tx.partMeasurementTemplate.findUnique.mockResolvedValueOnce({
      siblingGroupId: 'other-group',
      fhincd: 'PART-1',
      processGroup: 'CUTTING',
      fkojun: '10',
      resourceCd: 'R1',
      templateScope: 'THREE_KEY'
    });
    const service = new SelfInspectionItemLifecycleService({
      requireAccessPassword: vi.fn().mockResolvedValue(undefined)
    } as never);

    await expect(service.invalidate({
      target: {
        kind: 'schedule_row',
        scheduleRowId: 'row-1',
        templateId: 'template-unrelated-r1',
        productNo: 'PO-1',
        processGroup: 'CUTTING',
        resourceCd: 'R1',
        fseiban: 'FS-1',
        fhincd: 'PART-1',
        fhinmei: '品名'
      },
      requestId: 'request-unrelated',
      accessPassword: '2520',
      reason: '対象外',
      actor: { username: null, clientDeviceId: null, clientDeviceNameSnapshot: null }
    })).rejects.toThrow('削除対象の自主検査情報が現在のセッションと一致しません');
    expect(mocks.tx.selfInspectionItemInvalidation.create).not.toHaveBeenCalled();
  });
});
