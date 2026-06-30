import { describe, expect, it } from 'vitest';

import {
  hasDirtySelfInspectionDrafts,
  resolveCurrentEntryDraftSaveBlockReason,
  resolveSelfInspectionCompleteActionState,
  resolveSelfInspectionResumeGuideActionState,
  resolveSelfInspectionSaveActionState,
  selfInspectionActionReasonMessage,
  type SelfInspectionSessionActionContext
} from '../selfInspectionSessionActionState';

import { makeSelfInspectionSessionDetailForTest, makeSelfInspectionTemplateItemForTest } from './selfInspectionSessionTestFixtures';

function makeContext(
  overrides: Partial<SelfInspectionSessionActionContext> = {}
): SelfInspectionSessionActionContext {
  const items = [
    makeSelfInspectionTemplateItemForTest({ id: 'p1', sortOrder: 0 }),
    makeSelfInspectionTemplateItemForTest({ id: 'p2', sortOrder: 1 })
  ];
  const session = makeSelfInspectionSessionDetailForTest({
    items,
    expectedEntryCount: 2,
    selfInspectionMode: 'fixed_count'
  });
  const draft = { p1: '10', p2: '10' };
  const savedDraft = { p1: '10', p2: '10' };

  return {
    session,
    selectedEntryIndex: 0,
    draftValuesByEntryIndex: { 0: draft },
    savedDraftByEntryIndex: { 0: savedDraft },
    isSessionReadOnly: false,
    isSavingEntry: false,
    isCompletingSession: false,
    isDrawingCanvasReady: true,
    guideMode: 'manual',
    guideActionsEnabled: true,
    entryRegistrationReady: true,
    entryRegistrationDirty: false,
    requireMeasuringInstrumentTag: true,
    ...overrides
  };
}

describe('selfInspectionSessionActionState', () => {
  it('save is disabled when draft is not dirty', () => {
    const state = resolveSelfInspectionSaveActionState(makeContext());
    expect(state.enabled).toBe(false);
    expect(state.reason).toBe('no_changes');
  });

  it('save is disabled when a point is empty', () => {
    const state = resolveSelfInspectionSaveActionState(
      makeContext({
        draftValuesByEntryIndex: { 0: { p1: '10', p2: '' } },
        savedDraftByEntryIndex: { 0: { p1: '10', p2: '10' } }
      })
    );
    expect(state.enabled).toBe(false);
    expect(state.reason).toBe('incomplete_values');
  });

  it('save is disabled when value is invalid', () => {
    expect(resolveCurrentEntryDraftSaveBlockReason(
      makeContext().session,
      { p1: '10', p2: 'abc' }
    )).toBe('invalid_value');
  });

  it('save is disabled when value is ng', () => {
    const state = resolveSelfInspectionSaveActionState(
      makeContext({
        draftValuesByEntryIndex: { 0: { p1: '10', p2: '99' } },
        savedDraftByEntryIndex: { 0: { p1: '10', p2: '10' } }
      })
    );
    expect(state.enabled).toBe(false);
    expect(state.reason).toBe('ng_value');
  });

  it('save is enabled when NG value is acknowledged', () => {
    const state = resolveSelfInspectionSaveActionState(
      makeContext({
        draftValuesByEntryIndex: { 0: { p1: '10', p2: '99' } },
        savedDraftByEntryIndex: { 0: { p1: '10', p2: '10' } },
        outOfToleranceAcknowledgedByEntryIndex: { 0: { p2: true } }
      })
    );
    expect(state.enabled).toBe(true);
    expect(state.reason).toBeNull();
  });

  it('save is disabled while session completion is in flight', () => {
    const state = resolveSelfInspectionSaveActionState(
      makeContext({
        isCompletingSession: true,
        draftValuesByEntryIndex: { 0: { p1: '10.01', p2: '10' } },
        savedDraftByEntryIndex: { 0: { p1: '10', p2: '10' } }
      })
    );
    expect(state.enabled).toBe(false);
    expect(state.reason).toBe('completing');
  });

  it('save is disabled when NFC registration is missing', () => {
    const state = resolveSelfInspectionSaveActionState(
      makeContext({
        entryRegistrationReady: false,
        draftValuesByEntryIndex: { 0: { p1: '10.01', p2: '10' } },
        savedDraftByEntryIndex: { 0: { p1: '10', p2: '10' } }
      })
    );
    expect(state.enabled).toBe(false);
    expect(state.reason).toBe('missing_registration');
  });

  it('save is disabled with employee-only message when instrument tag is optional and employee registration is missing', () => {
    const state = resolveSelfInspectionSaveActionState(
      makeContext({
        requireMeasuringInstrumentTag: false,
        entryRegistrationReady: false,
        draftValuesByEntryIndex: { 0: { p1: '10.01', p2: '10' } },
        savedDraftByEntryIndex: { 0: { p1: '10', p2: '10' } }
      })
    );
    expect(state.enabled).toBe(false);
    expect(state.reason).toBe('missing_employee_registration');
    expect(selfInspectionActionReasonMessage(state.reason)).toContain('測定者');
  });

  it('save is enabled when only NFC registration is pending on a saved entry', () => {
    const state = resolveSelfInspectionSaveActionState(
      makeContext({
        entryRegistrationDirty: true,
        draftValuesByEntryIndex: { 0: { p1: '10', p2: '10' } },
        savedDraftByEntryIndex: { 0: { p1: '10', p2: '10' } }
      })
    );
    expect(state.enabled).toBe(true);
    expect(state.reason).toBeNull();
  });

  it('save is enabled when dirty and all points are ok', () => {
    const state = resolveSelfInspectionSaveActionState(
      makeContext({
        draftValuesByEntryIndex: { 0: { p1: '10.01', p2: '10' } },
        savedDraftByEntryIndex: { 0: { p1: '10', p2: '10' } }
      })
    );
    expect(state.enabled).toBe(true);
    expect(state.reason).toBeNull();
  });

  it('complete is disabled when required slots are missing', () => {
    const state = resolveSelfInspectionCompleteActionState(makeContext());
    expect(state.enabled).toBe(false);
    expect(state.reason).toBe('missing_required_entries');
  });

  it('complete is disabled when unsaved draft exists', () => {
    const state = resolveSelfInspectionCompleteActionState(
      makeContext({
        draftValuesByEntryIndex: { 0: { p1: '10.01', p2: '10' } },
        savedDraftByEntryIndex: { 0: { p1: '10', p2: '10' } }
      })
    );
    expect(state.enabled).toBe(false);
    expect(state.reason).toBe('unsaved_changes');
  });

  it('complete is enabled when required slots are saved and no dirty drafts', () => {
    const session = makeContext().session;
    const now = '2026-06-04T00:00:00.000Z';
    session.entries = [
      {
        id: 'e0',
        entryIndex: 0,
        entrySlotKind: 'fixed',
        entrySlotLabel: '1',
        createdByEmployeeId: 'emp-1',
        createdByEmployeeNameSnapshot: 'Tester',
        measuringInstrumentId: 'inst-1',
        measuringInstrumentManagementNumberSnapshot: 'MI-001',
        measuringInstrumentNameSnapshot: 'Caliper',
        measuringInstrumentTagUidSnapshot: 'inst-tag',
        createdAt: now,
        updatedAt: now,
        values: []
      },
      {
        id: 'e1',
        entryIndex: 1,
        entrySlotKind: 'fixed',
        entrySlotLabel: '2',
        createdByEmployeeId: 'emp-1',
        createdByEmployeeNameSnapshot: 'Tester',
        measuringInstrumentId: 'inst-1',
        measuringInstrumentManagementNumberSnapshot: 'MI-001',
        measuringInstrumentNameSnapshot: 'Caliper',
        measuringInstrumentTagUidSnapshot: 'inst-tag',
        createdAt: now,
        updatedAt: now,
        values: []
      }
    ];
    const state = resolveSelfInspectionCompleteActionState(
      makeContext({
        session,
        draftValuesByEntryIndex: {
          0: { p1: '10', p2: '10' },
          1: { p1: '10', p2: '10' }
        },
        savedDraftByEntryIndex: {
          0: { p1: '10', p2: '10' },
          1: { p1: '10', p2: '10' }
        }
      })
    );
    expect(state.enabled).toBe(true);
  });

  it('complete is enabled with employee registration only when instrument tag is optional', () => {
    const session = makeContext().session;
    const now = '2026-06-04T00:00:00.000Z';
    session.entries = [
      {
        id: 'e0',
        entryIndex: 0,
        entrySlotKind: 'fixed',
        entrySlotLabel: '1',
        createdByEmployeeId: 'emp-1',
        createdByEmployeeNameSnapshot: 'Tester',
        measuringInstrumentId: null,
        measuringInstrumentManagementNumberSnapshot: null,
        measuringInstrumentNameSnapshot: null,
        measuringInstrumentTagUidSnapshot: null,
        createdAt: now,
        updatedAt: now,
        values: []
      },
      {
        id: 'e1',
        entryIndex: 1,
        entrySlotKind: 'fixed',
        entrySlotLabel: '2',
        createdByEmployeeId: 'emp-1',
        createdByEmployeeNameSnapshot: 'Tester',
        measuringInstrumentId: null,
        measuringInstrumentManagementNumberSnapshot: null,
        measuringInstrumentNameSnapshot: null,
        measuringInstrumentTagUidSnapshot: null,
        createdAt: now,
        updatedAt: now,
        values: []
      }
    ];
    const state = resolveSelfInspectionCompleteActionState(
      makeContext({
        session,
        requireMeasuringInstrumentTag: false,
        draftValuesByEntryIndex: {
          0: { p1: '10', p2: '10' },
          1: { p1: '10', p2: '10' }
        },
        savedDraftByEntryIndex: {
          0: { p1: '10', p2: '10' },
          1: { p1: '10', p2: '10' }
        }
      })
    );
    expect(state.enabled).toBe(true);
  });

  it('complete is disabled for new sessions waiting for record approval', () => {
    const session = makeContext().session;
    const now = '2026-06-04T00:00:00.000Z';
    session.recordApprovalRequiredAt = now;
    session.recordApproval = null;
    session.entries = [
      {
        id: 'e0',
        entryIndex: 0,
        entrySlotKind: 'fixed',
        entrySlotLabel: '1',
        createdByEmployeeId: 'emp-1',
        createdByEmployeeNameSnapshot: 'Tester',
        measuringInstrumentId: 'inst-1',
        measuringInstrumentManagementNumberSnapshot: 'MI-001',
        measuringInstrumentNameSnapshot: 'Caliper',
        measuringInstrumentTagUidSnapshot: 'inst-tag',
        createdAt: now,
        updatedAt: now,
        values: []
      },
      {
        id: 'e1',
        entryIndex: 1,
        entrySlotKind: 'fixed',
        entrySlotLabel: '2',
        createdByEmployeeId: 'emp-1',
        createdByEmployeeNameSnapshot: 'Tester',
        measuringInstrumentId: 'inst-1',
        measuringInstrumentManagementNumberSnapshot: 'MI-001',
        measuringInstrumentNameSnapshot: 'Caliper',
        measuringInstrumentTagUidSnapshot: 'inst-tag',
        createdAt: now,
        updatedAt: now,
        values: []
      }
    ];
    const state = resolveSelfInspectionCompleteActionState(
      makeContext({
        session,
        draftValuesByEntryIndex: {
          0: { p1: '10', p2: '10' },
          1: { p1: '10', p2: '10' }
        },
        savedDraftByEntryIndex: {
          0: { p1: '10', p2: '10' },
          1: { p1: '10', p2: '10' }
        }
      })
    );
    expect(state.enabled).toBe(false);
    expect(state.reason).toBe('record_approval_required');
    expect(selfInspectionActionReasonMessage(state.reason)).toContain('検査記録確認画面');
  });

  it('complete is disabled when saved entries lack registration', () => {
    const session = makeContext().session;
    const now = '2026-06-04T00:00:00.000Z';
    session.entries = [
      {
        id: 'e0',
        entryIndex: 0,
        entrySlotKind: 'fixed',
        entrySlotLabel: '1',
        createdByEmployeeId: 'emp-1',
        createdByEmployeeNameSnapshot: 'Tester',
        measuringInstrumentId: null,
        measuringInstrumentManagementNumberSnapshot: null,
        measuringInstrumentNameSnapshot: null,
        measuringInstrumentTagUidSnapshot: null,
        createdAt: now,
        updatedAt: now,
        values: []
      },
      {
        id: 'e1',
        entryIndex: 1,
        entrySlotKind: 'fixed',
        entrySlotLabel: '2',
        createdByEmployeeId: 'emp-1',
        createdByEmployeeNameSnapshot: 'Tester',
        measuringInstrumentId: 'inst-1',
        measuringInstrumentManagementNumberSnapshot: 'MI-001',
        measuringInstrumentNameSnapshot: 'Caliper',
        measuringInstrumentTagUidSnapshot: 'inst-tag',
        createdAt: now,
        updatedAt: now,
        values: []
      }
    ];
    const state = resolveSelfInspectionCompleteActionState(
      makeContext({
        session,
        draftValuesByEntryIndex: {
          0: { p1: '10', p2: '10' },
          1: { p1: '10', p2: '10' }
        },
        savedDraftByEntryIndex: {
          0: { p1: '10', p2: '10' },
          1: { p1: '10', p2: '10' }
        }
      })
    );
    expect(state.enabled).toBe(false);
    expect(state.reason).toBe('incomplete_registration');
  });

  it('resume is disabled when already guided', () => {
    const state = resolveSelfInspectionResumeGuideActionState(
      makeContext({ guideMode: 'guided' })
    );
    expect(state.enabled).toBe(false);
    expect(state.reason).toBe('already_guided');
  });

  it('resume is enabled in manual mode when pending points exist', () => {
    const state = resolveSelfInspectionResumeGuideActionState(
      makeContext({
        draftValuesByEntryIndex: { 0: { p1: '', p2: '' } },
        savedDraftByEntryIndex: { 0: { p1: '', p2: '' } }
      })
    );
    expect(state.enabled).toBe(true);
  });

  it('resume is disabled when all points are ok and saved', () => {
    const state = resolveSelfInspectionResumeGuideActionState(makeContext());
    expect(state.enabled).toBe(false);
    expect(state.reason).toBe('no_pending_points_saved');
    expect(selfInspectionActionReasonMessage(state.reason)).toContain('未完了の測定点はありません');
  });

  it('resume is disabled when remaining NG point is acknowledged', () => {
    const state = resolveSelfInspectionResumeGuideActionState(
      makeContext({
        draftValuesByEntryIndex: { 0: { p1: '10', p2: '99' } },
        savedDraftByEntryIndex: { 0: { p1: '10', p2: '99' } },
        outOfToleranceAcknowledgedByEntryIndex: { 0: { p2: true } }
      })
    );
    expect(state.enabled).toBe(false);
    expect(state.reason).toBe('no_pending_points_saved');
  });

  it('resume is disabled when all points are ok but draft is unsaved', () => {
    const state = resolveSelfInspectionResumeGuideActionState(
      makeContext({
        draftValuesByEntryIndex: { 0: { p1: '10.01', p2: '10' } },
        savedDraftByEntryIndex: { 0: { p1: '10', p2: '10' } }
      })
    );
    expect(state.enabled).toBe(false);
    expect(state.reason).toBe('no_pending_points_unsaved');
    expect(selfInspectionActionReasonMessage(state.reason)).toContain('入力を保存');
  });

  it('hasDirtySelfInspectionDrafts mirrors listDirtySelfInspectionEntryIndices', () => {
    const ctx = makeContext({
      draftValuesByEntryIndex: { 0: { p1: '10.01', p2: '10' } },
      savedDraftByEntryIndex: { 0: { p1: '10', p2: '10' } }
    });
    expect(
      hasDirtySelfInspectionDrafts(ctx.session, ctx.draftValuesByEntryIndex, ctx.savedDraftByEntryIndex)
    ).toBe(true);
    expect(
      hasDirtySelfInspectionDrafts(
        makeContext().session,
        makeContext().draftValuesByEntryIndex,
        makeContext().savedDraftByEntryIndex
      )
    ).toBe(false);
  });
});
