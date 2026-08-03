import { beforeEach, describe, expect, it, vi } from 'vitest';

const delegates = vi.hoisted(() => ({
  loanEventService: { kind: 'loan-event-service-instance' },
  resolveOrCreateSession: vi.fn(),
  listSessions: vi.fn(),
  listRecordApprovalSessions: vi.fn(),
  getRecordApprovalSessionDetail: vi.fn(),
  resolveRecordApprovalApprover: vi.fn(),
  approveRecordApproval: vi.fn(),
  getSessionDetail: vi.fn(),
  getInspectorMeasurementSessionDetail: vi.fn(),
  createInspectorEntry: vi.fn(),
  updateInspectorEntry: vi.fn(),
  saveInspectorJudgements: vi.fn(),
  recordInspectorInstrumentPreUseInspection: vi.fn(),
  recordInstrumentPreUseInspection: vi.fn(),
  authenticateMeasurementActor: vi.fn(),
  createEntry: vi.fn(),
  updateEntry: vi.fn(),
  upsertDraftEntry: vi.fn(),
  completeSession: vi.fn(),
  listPendingOutOfToleranceReviews: vi.fn(),
  approveOutOfToleranceReview: vi.fn(),
  resetSession: vi.fn(),
  buildLeaderboardDecorations: vi.fn()
}));

vi.mock('../../measuring-instruments/measuring-instrument-loan-event.service.js', () => ({
  MeasuringInstrumentLoanEventService: class {
    constructor() {
      return delegates.loanEventService;
    }
  }
}));

vi.mock('../self-inspection/use-cases/session-start.js', () => ({
  resolveOrCreateSelfInspectionSession: delegates.resolveOrCreateSession
}));
vi.mock('../self-inspection/use-cases/session-query.js', () => ({
  listSelfInspectionSessions: delegates.listSessions,
  getSelfInspectionSessionDetail: delegates.getSessionDetail,
  getInspectorMeasurementSessionDetail: delegates.getInspectorMeasurementSessionDetail
}));
vi.mock('../self-inspection/use-cases/record-approval.js', () => ({
  listSelfInspectionRecordApprovalSessions: delegates.listRecordApprovalSessions,
  getSelfInspectionRecordApprovalSessionDetail: delegates.getRecordApprovalSessionDetail,
  resolveSelfInspectionRecordApprovalApprover: delegates.resolveRecordApprovalApprover,
  approveSelfInspectionRecordApproval: delegates.approveRecordApproval
}));
vi.mock('../self-inspection/use-cases/measurement-actor.js', () => ({
  createInspectorEntry: delegates.createInspectorEntry,
  updateInspectorEntry: delegates.updateInspectorEntry,
  saveInspectorEntryJudgements: delegates.saveInspectorJudgements,
  recordInspectorInstrumentPreUseInspection: delegates.recordInspectorInstrumentPreUseInspection,
  recordInstrumentPreUseInspection: delegates.recordInstrumentPreUseInspection,
  authenticateMeasurementActor: delegates.authenticateMeasurementActor
}));
vi.mock('../self-inspection/use-cases/operator-entry.js', () => ({
  createSelfInspectionEntry: delegates.createEntry,
  updateSelfInspectionEntry: delegates.updateEntry,
  upsertSelfInspectionDraftEntry: delegates.upsertDraftEntry
}));
vi.mock('../self-inspection/use-cases/session-completion.js', () => ({
  completeSelfInspectionSession: delegates.completeSession
}));
vi.mock('../self-inspection/use-cases/out-of-tolerance-review.js', () => ({
  listPendingSelfInspectionOutOfToleranceReviews: delegates.listPendingOutOfToleranceReviews,
  approveSelfInspectionOutOfToleranceReview: delegates.approveOutOfToleranceReview
}));
vi.mock('../self-inspection/use-cases/session-reset.js', () => ({
  resetSelfInspectionSession: delegates.resetSession
}));
vi.mock('../self-inspection/decoration.js', () => ({
  buildLeaderboardDecorations: delegates.buildLeaderboardDecorations,
  createSelfInspectionDecorationCache: vi.fn(),
  ensureSelfInspectionSessionsInCache: vi.fn(),
  ensureSelfInspectionTemplatesForRows: vi.fn(),
  pickSessionForScheduleRow: vi.fn()
}));

import { SelfInspectionService } from '../self-inspection.service.js';

describe('SelfInspectionService facade', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps the exact 22-method public surface', () => {
    expect(
      Object.getOwnPropertyNames(SelfInspectionService.prototype)
        .filter((name) => name !== 'constructor')
        .sort()
    ).toEqual(
      [
        'approveOutOfToleranceReview',
        'approveRecordApproval',
        'authenticateMeasurementActor',
        'buildLeaderboardDecorations',
        'completeSession',
        'createEntry',
        'createInspectorEntry',
        'getInspectorMeasurementSessionDetail',
        'getRecordApprovalSessionDetail',
        'getSessionDetail',
        'listPendingOutOfToleranceReviews',
        'listRecordApprovalSessions',
        'listSessions',
        'recordInspectorInstrumentPreUseInspection',
        'recordInstrumentPreUseInspection',
        'resetSession',
        'resolveOrCreateSession',
        'resolveRecordApprovalApprover',
        'saveInspectorJudgements',
        'updateEntry',
        'updateInspectorEntry',
        'upsertDraftEntry'
      ].sort()
    );
  });

  it('delegates every public method with unchanged arguments and return values', async () => {
    const service = new SelfInspectionService();
    const sessionId = 'session-id';
    const entryId = 'entry-id';
    const entryIndex = 3;
    const input = { marker: 'input' } as never;
    const options = { entryIndex };
    const rows = [{ id: 'row-id', rowData: {} }] as never;
    const scope = { siteKey: 'site' };
    const cache = { marker: 'cache' } as never;
    const cases: Array<{
      name: string;
      delegate: ReturnType<typeof vi.fn>;
      invoke: () => Promise<unknown>;
      expectedArgs: unknown[];
    }> = [
      {
        name: 'resolveOrCreateSession',
        delegate: delegates.resolveOrCreateSession,
        invoke: () => service.resolveOrCreateSession(input),
        expectedArgs: [input]
      },
      {
        name: 'listSessions',
        delegate: delegates.listSessions,
        invoke: () => service.listSessions(input),
        expectedArgs: [input]
      },
      {
        name: 'listRecordApprovalSessions',
        delegate: delegates.listRecordApprovalSessions,
        invoke: () => service.listRecordApprovalSessions(input),
        expectedArgs: [input]
      },
      {
        name: 'getRecordApprovalSessionDetail',
        delegate: delegates.getRecordApprovalSessionDetail,
        invoke: () => service.getRecordApprovalSessionDetail(sessionId),
        expectedArgs: [sessionId]
      },
      {
        name: 'resolveRecordApprovalApprover',
        delegate: delegates.resolveRecordApprovalApprover,
        invoke: () => service.resolveRecordApprovalApprover('uid'),
        expectedArgs: ['uid']
      },
      {
        name: 'approveRecordApproval',
        delegate: delegates.approveRecordApproval,
        invoke: () => service.approveRecordApproval(sessionId, input),
        expectedArgs: [sessionId, input]
      },
      {
        name: 'getSessionDetail',
        delegate: delegates.getSessionDetail,
        invoke: () => service.getSessionDetail(sessionId, options),
        expectedArgs: [sessionId, options]
      },
      {
        name: 'getInspectorMeasurementSessionDetail',
        delegate: delegates.getInspectorMeasurementSessionDetail,
        invoke: () => service.getInspectorMeasurementSessionDetail(sessionId, options),
        expectedArgs: [sessionId, options]
      },
      {
        name: 'createInspectorEntry',
        delegate: delegates.createInspectorEntry,
        invoke: () => service.createInspectorEntry(sessionId, input),
        expectedArgs: [sessionId, input]
      },
      {
        name: 'updateInspectorEntry',
        delegate: delegates.updateInspectorEntry,
        invoke: () => service.updateInspectorEntry(sessionId, entryId, input),
        expectedArgs: [sessionId, entryId, input]
      },
      {
        name: 'saveInspectorJudgements',
        delegate: delegates.saveInspectorJudgements,
        invoke: () => service.saveInspectorJudgements(sessionId, entryId, input),
        expectedArgs: [sessionId, entryId, input]
      },
      {
        name: 'recordInspectorInstrumentPreUseInspection',
        delegate: delegates.recordInspectorInstrumentPreUseInspection,
        invoke: () => service.recordInspectorInstrumentPreUseInspection(sessionId, entryIndex, input),
        expectedArgs: [delegates.loanEventService, sessionId, entryIndex, input]
      },
      {
        name: 'recordInstrumentPreUseInspection',
        delegate: delegates.recordInstrumentPreUseInspection,
        invoke: () => service.recordInstrumentPreUseInspection(sessionId, entryIndex, input),
        expectedArgs: [delegates.loanEventService, sessionId, entryIndex, input]
      },
      {
        name: 'authenticateMeasurementActor',
        delegate: delegates.authenticateMeasurementActor,
        invoke: () => service.authenticateMeasurementActor(sessionId, input),
        expectedArgs: [sessionId, input]
      },
      {
        name: 'createEntry',
        delegate: delegates.createEntry,
        invoke: () => service.createEntry(sessionId, input),
        expectedArgs: [sessionId, input]
      },
      {
        name: 'updateEntry',
        delegate: delegates.updateEntry,
        invoke: () => service.updateEntry(sessionId, entryId, input),
        expectedArgs: [sessionId, entryId, input]
      },
      {
        name: 'upsertDraftEntry',
        delegate: delegates.upsertDraftEntry,
        invoke: () => service.upsertDraftEntry(sessionId, input),
        expectedArgs: [sessionId, input]
      },
      {
        name: 'completeSession',
        delegate: delegates.completeSession,
        invoke: () => service.completeSession(sessionId),
        expectedArgs: [sessionId]
      },
      {
        name: 'listPendingOutOfToleranceReviews',
        delegate: delegates.listPendingOutOfToleranceReviews,
        invoke: () => service.listPendingOutOfToleranceReviews(),
        expectedArgs: []
      },
      {
        name: 'approveOutOfToleranceReview',
        delegate: delegates.approveOutOfToleranceReview,
        invoke: () => service.approveOutOfToleranceReview(sessionId, input),
        expectedArgs: [sessionId, input]
      },
      {
        name: 'resetSession',
        delegate: delegates.resetSession,
        invoke: () => service.resetSession(sessionId, input),
        expectedArgs: [sessionId, input]
      },
      {
        name: 'buildLeaderboardDecorations',
        delegate: delegates.buildLeaderboardDecorations,
        invoke: () => service.buildLeaderboardDecorations(rows, scope, cache),
        expectedArgs: [rows, scope, cache]
      }
    ];

    for (const testCase of cases) {
      const delegatedResult = { method: testCase.name };
      testCase.delegate.mockResolvedValueOnce(delegatedResult);
      await expect(testCase.invoke()).resolves.toBe(delegatedResult);
      expect(testCase.delegate).toHaveBeenLastCalledWith(...testCase.expectedArgs);
    }
  });
});
