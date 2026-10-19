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
    buildSessionBusinessKey: vi.fn(),
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
  buildSessionBusinessKey: mocks.buildSessionBusinessKey,
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
import { PRODUCTION_SCHEDULE_DASHBOARD_ID, SEIBAN_MACHINE_NAME_UNREGISTERED_LABEL } from '../../production-schedule/constants.js';

describe('self-inspection machine-name API wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveMachineNames.mockResolvedValue({ machineNames: { 'FS-1': '正本機種名' } });
    mocks.verifyScheduleRow.mockResolvedValue({});
    mocks.lockBusinessKey.mockResolvedValue(undefined);
    mocks.loadParticipantSummaries.mockResolvedValue(new Map());
    mocks.loadPendingReviewCounts.mockResolvedValue(new Map());
    mocks.prisma.partMeasurementTemplate.findFirst.mockResolvedValue({
      id: 'template-1', fhincd: 'FH-1', resourceCd: 'R1', processGroup: 'CUTTING',
      fkojun: '', siblingGroupId: null, isActive: true, templateScope: 'THREE_KEY'
    });
    mocks.buildSessionBusinessKey.mockImplementation((input: {
      productNo: string; processGroup: string; resourceCd: string; scheduleRowId: string;
    }) => [input.productNo, input.processGroup, input.resourceCd, input.scheduleRowId].join('::'));
    mocks.prisma.productionScheduleOrderSupplement.findFirst.mockResolvedValue({ plannedQuantity: 5 });
    mocks.transaction.selfInspectionItemInvalidation.findUnique.mockResolvedValue(null);
    mocks.transaction.selfInspectionSession.upsert.mockResolvedValue({ id: 'session-1', machineName: '正本機種名' });
    mocks.serializeSession.mockImplementation(async (session: Record<string, unknown>) => ({
      id: session.id,
      templateId: session.templateId,
      resourceCd: session.resourceCd,
      scheduleResourceCd: session.scheduleResourceCd,
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
    expect(mocks.prisma.productionScheduleOrderSupplement.findFirst).toHaveBeenCalledWith({
      where: {
        csvDashboardRowId: 'row-1',
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID
      },
      select: { plannedQuantity: true }
    });
    expect(mocks.resolveMachineNames).toHaveBeenCalledWith(['FS-1']);
    expect(mocks.transaction.selfInspectionSession.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ machineName: '正本機種名' })
      })
    );
  });

  it('starts on a selected sibling resource while keeping the scheduled resource as the session key', async () => {
    const plannedTemplate = {
      id: 'template-plan', fhincd: 'FH-1', resourceCd: 'R1', processGroup: 'CUTTING',
      fkojun: '10', siblingGroupId: 'group-10', isActive: true, templateScope: 'THREE_KEY'
    };
    mocks.verifyScheduleRow.mockResolvedValue({ FKOJUN: 10 });
    mocks.prisma.partMeasurementTemplate.findFirst.mockImplementation(async (args: { where: Record<string, unknown> }) => {
      if (args.where.id === 'template-plan') return plannedTemplate;
      if (args.where.resourceCd === 'R2' || args.where.resourceCd === 'R3') {
        return {
          ...plannedTemplate,
          id: `template-${args.where.resourceCd}`,
          resourceCd: args.where.resourceCd
        };
      }
      return null;
    });

    const persistedByBusinessKey = new Map<string, Record<string, unknown>>();
    mocks.transaction.selfInspectionSession.upsert.mockImplementation(async (args: {
      where: { sessionBusinessKey: string };
      create: Record<string, unknown>;
    }) => {
      const existing = persistedByBusinessKey.get(args.where.sessionBusinessKey);
      if (existing) return existing;
      const created = { id: 'session-R2', ...args.create };
      persistedByBusinessKey.set(args.where.sessionBusinessKey, created);
      return created;
    });

    const results = [];
    for (const resourceCd of ['R2', 'R3']) {
      results.push(await resolveOrCreateSelfInspectionSession({
        templateId: 'template-plan',
        productNo: 'PO-1',
        processGroup: 'CUTTING',
        resourceCd,
        scheduleRowId: 'row-1',
        fseiban: 'FS-1',
        fhincd: 'FH-1',
        fhinmei: '品名'
      }));
    }

    expect(mocks.verifyScheduleRow).toHaveBeenNthCalledWith(1, 'row-1', {
      productNo: 'PO-1', fseiban: 'FS-1', fhincd: 'FH-1', resourceCd: 'R1'
    });
    const upserts = mocks.transaction.selfInspectionSession.upsert.mock.calls;
    expect(upserts).toHaveLength(2);
    expect(upserts.map(([args]) => args.where.sessionBusinessKey)).toEqual([
      'PO-1::CUTTING::R1::row-1',
      'PO-1::CUTTING::R1::row-1'
    ]);
    expect(upserts.map(([args]) => args.create)).toEqual([
      expect.objectContaining({ templateId: 'template-R2', scheduleResourceCd: 'R1', resourceCd: 'R2' }),
      expect.objectContaining({ templateId: 'template-R3', scheduleResourceCd: 'R1', resourceCd: 'R3' })
    ]);
    expect(upserts[1]?.[0].update).toEqual({});
    expect(results).toEqual([
      expect.objectContaining({
        id: 'session-R2', templateId: 'template-R2', scheduleResourceCd: 'R1', resourceCd: 'R2'
      }),
      expect.objectContaining({
        id: 'session-R2', templateId: 'template-R2', scheduleResourceCd: 'R1', resourceCd: 'R2'
      })
    ]);
  });

  it('requires a matching supplement order for unassigned seiban', async () => {
    await resolveOrCreateSelfInspectionSession({
      templateId: 'template-1',
      productNo: '0003729969',
      processGroup: 'CUTTING',
      resourceCd: 'R1',
      scheduleRowId: 'row-1',
      fseiban: '********',
      fhincd: 'FH-1',
      fhinmei: '品名'
    });

    expect(mocks.prisma.productionScheduleOrderSupplement.findFirst).toHaveBeenCalledWith({
      where: {
        csvDashboardRowId: 'row-1',
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        productNo: '0003729969'
      },
      select: { plannedQuantity: true }
    });
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
