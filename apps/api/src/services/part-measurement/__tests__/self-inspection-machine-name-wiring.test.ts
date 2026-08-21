import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const transaction = {
    selfInspectionItemInvalidation: { findUnique: vi.fn() },
    selfInspectionSession: { upsert: vi.fn() }
  };
  return {
    transaction,
    prisma: {
      $transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) => callback(transaction)),
      partMeasurementTemplate: { findFirst: vi.fn() },
      productionScheduleOrderSupplement: { findFirst: vi.fn() },
      selfInspectionSession: { findMany: vi.fn() }
    },
    resolveMachineNames: vi.fn(),
    verifyScheduleRow: vi.fn(),
    serializeSession: vi.fn(),
    serializeSummary: vi.fn(),
    loadParticipantSummaries: vi.fn(),
    loadPendingReviewCounts: vi.fn(),
    lockBusinessKey: vi.fn()
  };
});

vi.mock('../../../lib/prisma.js', () => ({ prisma: mocks.prisma }));
vi.mock('../../production-schedule/seiban-machine-display-names.service.js', () => ({
  resolveSeibanMachineDisplayNamesBatched: mocks.resolveMachineNames
}));
vi.mock('../../production-schedule/verify-production-schedule-row.js', () => ({
  verifyProductionScheduleRowOrThrow: mocks.verifyScheduleRow
}));
vi.mock('../self-inspection-item-lock.repository.js', () => ({
  lockSelfInspectionItemBusinessKey: mocks.lockBusinessKey
}));
vi.mock('../self-inspection/shared.js', () => ({
  buildSessionBusinessKey: vi.fn(() => 'business-key'),
  hasInspectionDrawingTemplate: vi.fn(() => true),
  normalizeText: (value: string | null | undefined) => (value ?? '').trim(),
  resolveExpectedEntryCount: vi.fn(() => 1),
  templateConfigFromTemplate: vi.fn(() => ({
    selfInspectionMode: 'FULL',
    selfInspectionFixedCount: null,
    selfInspectionSampleSize: null
  })),
  buildInspectorMeasurementCompletion: vi.fn(),
  enrichSessionEntryCountFields: vi.fn(),
  resolveStatus: vi.fn(),
  serializeProcessGroup: vi.fn((value: string) => value === 'GRINDING' ? 'grinding' : 'cutting'),
  sessionForEntryCountPolicy: vi.fn(),
  isValueWithinTolerance: vi.fn()
}));
vi.mock('../self-inspection/serialization.js', () => ({
  listSessionsSummaryInclude: {},
  loadPendingReviewCountsBySessionIds: mocks.loadPendingReviewCounts,
  serializeDecisionWorkflow: vi.fn(),
  serializeInspectorEntry: vi.fn(),
  serializeInspectorEntryMeta: vi.fn(),
  serializeLotEntry: vi.fn(),
  serializeLotEntryMeta: vi.fn(),
  serializeRecordApproval: vi.fn(),
  serializeSessionSummary: mocks.serializeSummary,
  serializeSessionSummaryWithAggregatedParticipantNames: mocks.serializeSession
}));
vi.mock('../self-inspection-participant-names.query.js', () => ({
  loadParticipantSummariesBySessionIds: mocks.loadParticipantSummaries
}));

import { listSelfInspectionSessions } from '../self-inspection/use-cases/session-query.js';
import { resolveOrCreateSelfInspectionSession } from '../self-inspection/use-cases/session-start.js';
import { SEIBAN_MACHINE_NAME_UNREGISTERED_LABEL } from '../../production-schedule/constants.js';

describe('self-inspection machine-name API wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveMachineNames.mockResolvedValue({ machineNames: { 'FS-1': '正本機種名' } });
    mocks.verifyScheduleRow.mockResolvedValue(undefined);
    mocks.lockBusinessKey.mockResolvedValue(undefined);
    mocks.loadParticipantSummaries.mockResolvedValue(new Map());
    mocks.loadPendingReviewCounts.mockResolvedValue(new Map());
    mocks.prisma.partMeasurementTemplate.findFirst.mockResolvedValue({ id: 'template-1', fhincd: 'FH-1' });
    mocks.prisma.productionScheduleOrderSupplement.findFirst.mockResolvedValue({ plannedQuantity: 5 });
    mocks.transaction.selfInspectionItemInvalidation.findUnique.mockResolvedValue(null);
    mocks.transaction.selfInspectionSession.upsert.mockResolvedValue({ machineName: '正本機種名' });
    mocks.serializeSession.mockImplementation(async (session: { machineName: string | null }) => ({
      machineName: session.machineName
    }));
    mocks.serializeSummary.mockImplementation((session: { id: string; machineName: string | null }) => ({
      id: session.id,
      status: 'in_progress',
      machineName: session.machineName
    }));
  });

  it('stores the canonical machine name after schedule-row verification', async () => {
    await resolveOrCreateSelfInspectionSession({
      templateId: 'template-1',
      productNo: 'PO-1',
      processGroup: 'CUTTING',
      resourceCd: 'R1',
      scheduleRowId: 'row-1',
      fseiban: 'FS-1',
      fhincd: 'FH-1',
      fhinmei: '品名',
      machineName: 'client supplied value'
    });

    expect(mocks.verifyScheduleRow).toHaveBeenCalled();
    expect(mocks.resolveMachineNames).toHaveBeenCalledWith(['FS-1']);
    expect(mocks.transaction.selfInspectionSession.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ machineName: '正本機種名' })
      })
    );
  });

  it('does not persist the unresolved machine-name sentinel as a canonical name', async () => {
    mocks.resolveMachineNames.mockResolvedValueOnce({
      machineNames: { 'FS-1': SEIBAN_MACHINE_NAME_UNREGISTERED_LABEL }
    });

    await resolveOrCreateSelfInspectionSession({
      templateId: 'template-1',
      productNo: 'PO-1',
      processGroup: 'CUTTING',
      resourceCd: 'R1',
      scheduleRowId: 'row-1',
      fseiban: 'FS-1',
      fhincd: 'FH-1',
      fhinmei: '品名'
    });

    expect(mocks.transaction.selfInspectionSession.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ machineName: null })
      })
    );
  });

  it('fills a missing stored machine name in the session-list DTO from the canonical resolver', async () => {
    mocks.prisma.selfInspectionSession.findMany.mockResolvedValue([
      { id: 'session-missing', machineName: null, fseiban: 'FS-1' },
      { id: 'session-existing', machineName: '保存済み機種', fseiban: 'FS-2' }
    ]);

    const result = await listSelfInspectionSessions({ status: 'in_progress' });

    expect(mocks.resolveMachineNames).toHaveBeenCalledWith(['FS-1']);
    expect(result.sessions).toEqual([
      { id: 'session-missing', status: 'in_progress', machineName: '正本機種名' },
      { id: 'session-existing', status: 'in_progress', machineName: '保存済み機種' }
    ]);
  });

  it('re-resolves a previously persisted unresolved sentinel after the source data is updated', async () => {
    mocks.prisma.selfInspectionSession.findMany.mockResolvedValue([
      {
        id: 'session-sentinel',
        machineName: SEIBAN_MACHINE_NAME_UNREGISTERED_LABEL,
        fseiban: 'FS-1'
      }
    ]);
    mocks.resolveMachineNames.mockResolvedValueOnce({
      machineNames: { 'FS-1': '後日解決した正本機種名' }
    });

    const result = await listSelfInspectionSessions({ status: 'in_progress' });

    expect(mocks.resolveMachineNames).toHaveBeenCalledWith(['FS-1']);
    expect(result.sessions).toEqual([
      {
        id: 'session-sentinel',
        status: 'in_progress',
        machineName: '後日解決した正本機種名'
      }
    ]);
  });
});
