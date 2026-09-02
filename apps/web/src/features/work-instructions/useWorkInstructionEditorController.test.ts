import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMocks = vi.hoisted(() => ({
  copy: vi.fn(),
  createAuthentication: vi.fn(),
  createImageRegion: vi.fn(),
  deleteSourceImages: vi.fn(),
  discard: vi.fn(),
  findTextCandidates: vi.fn(),
  history: vi.fn(),
  audit: vi.fn(),
  publish: vi.fn(),
  save: vi.fn(),
  uploadImage: vi.fn(),
  useEditorGroup: vi.fn()
}));

vi.mock('../../api/client', () => ({
  copyWorkInstructionOverlayDraft: apiMocks.copy,
  createWorkInstructionEditorAuthentication: apiMocks.createAuthentication,
  createWorkInstructionImageRegion: apiMocks.createImageRegion,
  deleteWorkInstructionSourceVersionImages: apiMocks.deleteSourceImages,
  discardWorkInstructionOverlayDraft: apiMocks.discard,
  findWorkInstructionTextCandidates: apiMocks.findTextCandidates,
  listWorkInstructionRevisionHistory: apiMocks.history,
  listWorkInstructionEditorAudit: apiMocks.audit,
  publishWorkInstructionOverlayDraft: apiMocks.publish,
  saveWorkInstructionOverlayDraft: apiMocks.save,
  uploadWorkInstructionOverlayImage: apiMocks.uploadImage
}));

vi.mock('../../api/hooks/work-instructions', () => ({
  useWorkInstructionEditorGroup: apiMocks.useEditorGroup
}));

import { useWorkInstructionEditorController } from './useWorkInstructionEditorController';

import type {
  WorkInstructionEditorGroupDto,
  WorkInstructionEditorStepDto,
  WorkInstructionEditRevisionDto,
  WorkInstructionMemoOverrideDto,
  WorkInstructionRevisionHistoryItemDto,
  WorkInstructionSourceVersionDto
} from '../../api/domains/work-instruction-overlays';
import type { WorkInstructionOverlayElement } from '../../api/domains/work-instructions';

const range = { xRatio: 0.1, yRatio: 0.2, widthRatio: 0.3, heightRatio: 0.2 };

function makeStep(overlays: WorkInstructionOverlayElement[] = []): WorkInstructionEditorStepDto {
  return {
    stepKey: 'sharepoint:work-instructions:1:1',
    sourceVersionId: 'latest-1',
    sourceSystem: 'sharepoint',
    sourceList: 'work-instructions',
    sourceItemId: 1,
    step: 1,
    operation: null,
    text: '加工面を確認します。',
    imageName: 'source.png',
    imageAssetId: 'source-asset-1',
    imageUrl: '/api/work-instructions/assets/source-asset-1',
    imageMimeType: 'image/png',
    imageSha256: 'source-sha',
    sourceModified: '2026-08-31T00:00:00.000Z',
    contentHash: 'latest-hash',
    memoFingerprint: 'target-memo-fingerprint',
    overlays
  };
}

function makeVersion(id: string, status: WorkInstructionSourceVersionDto['status']): WorkInstructionSourceVersionDto {
  return {
    id,
    revisionNumber: 2,
    sourceModified: '2026-08-31T00:00:00.000Z',
    contentHash: 'latest-hash',
    status,
    steps: [makeStep()]
  };
}

function makeDraft(
  overlays: WorkInstructionOverlayElement[] = [],
  editVersion = 0,
  memoOverrides: WorkInstructionMemoOverrideDto[] = []
): WorkInstructionEditRevisionDto {
  const stepOverlays = overlays.filter((element) => element.sourceStep !== null && element.migrationState !== 'UNASSIGNED');
  return {
    id: 'draft-1',
    sourceVersionId: 'latest-1',
    status: 'draft',
    revisionNumber: 1,
    editVersion,
    sourceModified: '2026-08-31T00:00:00.000Z',
    contentHash: 'latest-hash',
    baseContentHash: 'latest-hash',
    steps: [makeStep(stepOverlays)],
    overlays,
    memoOverrides,
    assets: {}
  };
}

function makeHistory(
  sourceVersionId: string,
  canDeleteImage: boolean,
  imageDeletedAt: string | null = null
): WorkInstructionRevisionHistoryItemDto {
  return {
    id: `history-${sourceVersionId}`,
    rowId: 'row-1',
    sourceVersionId,
    revisionNumber: 1,
    sourceModified: '2026-08-31T00:00:00.000Z',
    contentHash: 'archived-hash',
    status: 'archived',
    isLatest: false,
    isPublished: false,
    publishedRevisionId: null,
    annotationRevisionId: null,
    imageCount: 2,
    deletedImageCount: imageDeletedAt ? 2 : 0,
    eligibleImageCount: canDeleteImage ? 2 : 0,
    canDeleteImage,
    imageDeletedAt,
    imageDeletedBy: imageDeletedAt ? 'admin' : null,
    images: []
  };
}

function makeGroup(
  draft: WorkInstructionEditRevisionDto | null = null,
  history: WorkInstructionRevisionHistoryItemDto[] = []
): WorkInstructionEditorGroupDto {
  return {
    partNumber: 'PART-1',
    shootingTarget: '加工',
    rows: [{
      rowId: 'row-1',
      source: { system: 'sharepoint', list: 'work-instructions', itemId: 1 },
      published: makeVersion('published-1', 'published'),
      latest: makeVersion('latest-1', 'latest'),
      draft,
      updateAvailable: true
    }],
    migration: {
      total: 0,
      migrated: 0,
      needsReview: 0,
      unassigned: 0,
      skipped: 0,
      memo: { total: 0, migrated: 0, needsReview: 0, unassigned: 0, skipped: 0 }
    },
    history
  };
}

function renderEditor() {
  return renderHook(() => useWorkInstructionEditorController({
    partNumber: 'PART-1',
    shootingTarget: '加工'
  }));
}

async function authenticate(hook: ReturnType<typeof renderEditor>) {
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  await act(async () => {
    await hook.result.current.authenticate('employee-tag-1');
  });
  await waitFor(() => expect(hook.result.current.accessGranted).toBe(true));
}

describe('useWorkInstructionEditorController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    apiMocks.useEditorGroup.mockReturnValue({
      data: makeGroup(),
      isLoading: false,
      isError: false,
      refetch: vi.fn().mockResolvedValue({ data: makeGroup() })
    });
    apiMocks.copy.mockResolvedValue({ group: makeGroup(makeDraft()), revisions: [makeDraft()] });
    apiMocks.createAuthentication.mockResolvedValue({
      id: 'editor-authentication-1',
      employee: { id: 'employee-1', employeeCode: '0001', displayName: '山田 太郎' },
      authenticatedAt: '2026-09-02T00:00:00.000Z',
      expiresAt: '2026-09-02T04:00:00.000Z'
    });
    apiMocks.findTextCandidates.mockResolvedValue([]);
    apiMocks.history.mockResolvedValue([]);
    apiMocks.audit.mockResolvedValue([]);
    apiMocks.createImageRegion.mockRejectedValue(new Error('ROI unavailable'));
    apiMocks.uploadImage.mockResolvedValue({
      assetId: 'uploaded-1',
      storageKey: 'edit/uploaded-1.png',
      contentType: 'image/png',
      byteSize: 12,
      url: '/api/work-instructions/edit-assets/uploaded-1'
    });
  });

  it('keeps manual OCR fallback and image upload fallback usable when ROI services fail', async () => {
    const hook = renderEditor();
    await authenticate(hook);

    act(() => hook.result.current.setPendingRange(range));
    await act(async () => {
      await hook.result.current.createOverlay('TEXT');
    });
    expect(apiMocks.findTextCandidates).toHaveBeenCalledWith({
      revisionId: 'draft-1',
      stepKey: 'sharepoint:work-instructions:1:1',
      authenticationId: 'editor-authentication-1',
      bbox: range
    });
    expect(hook.result.current.selectedElement).toMatchObject({ kind: 'TEXT', text: 'ここに文章を入力' });

    act(() => hook.result.current.setPendingRange({ ...range, xRatio: 0.5 }));
    await act(async () => {
      await hook.result.current.createOverlay('IMAGE');
    });
    expect(apiMocks.createImageRegion).toHaveBeenCalledWith({
      revisionId: 'draft-1',
      stepKey: 'sharepoint:work-instructions:1:1',
      authenticationId: 'editor-authentication-1',
      bbox: { ...range, xRatio: 0.5 }
    });
    expect(hook.result.current.selectedElement).toMatchObject({ kind: 'IMAGE', assetId: '' });

    const file = new File(['image'], 'replacement.png', { type: 'image/png' });
    await act(async () => {
      await hook.result.current.uploadImage(file);
    });
    expect(apiMocks.uploadImage).toHaveBeenCalledWith({
      revisionId: 'draft-1',
      stepKey: 'sharepoint:work-instructions:1:1',
      authenticationId: 'editor-authentication-1',
      file
    });
    expect(hook.result.current.selectedElement).toMatchObject({ kind: 'IMAGE', assetId: 'uploaded-1' });
    expect(hook.result.current.activeAssets['uploaded-1']).toMatchObject({
      url: '/api/work-instructions/edit-assets/uploaded-1'
    });
  });

  it('retains local elements on 409, persists recovery, and supports explicit re-save', async () => {
    const hook = renderEditor();
    await authenticate(hook);
    act(() => hook.result.current.setPendingRange(range));
    await act(async () => {
      await hook.result.current.createOverlay('SHAPE');
    });
    const localElements = hook.result.current.activeElements;
    apiMocks.save.mockRejectedValueOnce({
      response: { status: 409, data: { errorCode: 'WORK_INSTRUCTION_EDIT_CONFLICT', details: { currentEditVersion: 5 } } }
    });

    await act(async () => {
      await hook.result.current.save();
    });
    expect(hook.result.current.conflict).toEqual({ revisionId: 'draft-1', currentEditVersion: 5 });
    expect(hook.result.current.activeElements).toEqual(localElements);
    await waitFor(() => expect(window.localStorage.getItem('kiosk-work-instruction-editor:PART-1:加工:draft-1')).toContain('draft-1'), { timeout: 2_000 });

    apiMocks.save.mockResolvedValueOnce(makeDraft(localElements, 6));
    await act(async () => {
      await hook.result.current.retryConflictSave();
    });
    expect(apiMocks.save).toHaveBeenLastCalledWith(expect.objectContaining({
      revisionId: 'draft-1',
      expectedEditVersion: 5,
      elements: expect.arrayContaining([expect.objectContaining({ migrationState: 'MIGRATED' })])
    }));
    expect(hook.result.current.conflict).toBeNull();
    expect(hook.result.current.activeElements).toEqual(localElements);
    expect(window.localStorage.getItem('kiosk-work-instruction-editor:PART-1:加工:draft-1')).toBeNull();
  });

  it('keeps a successful earlier row editVersion when a later row fails with a non-edit 409', async () => {
    const group = makeGroup(makeDraft());
    const secondDraft = { ...makeDraft(), id: 'draft-2', sourceVersionId: 'latest-2' };
    group.rows = [
      ...group.rows,
      { ...group.rows[0]!, rowId: 'row-2', latest: makeVersion('latest-2', 'latest'), published: makeVersion('published-2', 'published'), draft: secondDraft }
    ];
    group.migration = {
      total: 0,
      migrated: 0,
      needsReview: 0,
      unassigned: 0,
      skipped: 0,
      memo: { total: 0, migrated: 0, needsReview: 0, unassigned: 0, skipped: 0 }
    };
    apiMocks.useEditorGroup.mockReturnValue({
      data: group,
      isLoading: false,
      isError: false,
      refetch: vi.fn().mockResolvedValue({ data: group })
    });
    apiMocks.copy.mockResolvedValueOnce({ group, revisions: group.rows.flatMap((row) => row.draft ? [row.draft] : []) });
    const hook = renderEditor();
    await authenticate(hook);
    await waitFor(() => expect(hook.result.current.selectedStepKey).toBeTruthy());
    act(() => hook.result.current.updateMemo(hook.result.current.selectedStepKey!, 'row-1変更'));
    act(() => hook.result.current.selectRow('row-2'));
    act(() => hook.result.current.updateMemo(hook.result.current.selectedStepKey!, 'row-2変更'));
    await waitFor(() => expect(hook.result.current.isDirty).toBe(true));

    apiMocks.save
      .mockResolvedValueOnce(makeDraft([], 1))
      .mockRejectedValueOnce({
        response: {
          status: 409,
          data: {
            errorCode: 'WORK_INSTRUCTION_MEMO_MIGRATION_RESOLUTION_REQUIRED',
            message: 'memoの移植状態をKEEPまたはUSE_SOURCEで解決してください'
          }
        }
      });

    await act(async () => {
      await hook.result.current.save();
    });

    expect(hook.result.current.group?.rows.find((row) => row.rowId === 'row-1')?.draft?.editVersion).toBe(1);
    expect(hook.result.current.group?.rows.find((row) => row.rowId === 'row-2')?.draft?.editVersion).toBe(0);
    expect(hook.result.current.conflict).toBeNull();
    expect(hook.result.current.message).toBe('memoの移植状態をKEEPまたはUSE_SOURCEで解決してください');
  });

  it('clears conflict recovery when retry receives a non-edit 409', async () => {
    const hook = renderEditor();
    await authenticate(hook);
    act(() => hook.result.current.setPendingRange(range));
    await act(async () => {
      await hook.result.current.createOverlay('SHAPE');
    });
    apiMocks.save.mockRejectedValueOnce({
      response: { status: 409, data: { errorCode: 'WORK_INSTRUCTION_EDIT_CONFLICT', details: { currentEditVersion: 5 } } }
    });
    await act(async () => {
      await hook.result.current.save();
    });
    expect(hook.result.current.conflict).toEqual({ revisionId: 'draft-1', currentEditVersion: 5 });

    apiMocks.save.mockRejectedValueOnce({
      response: {
        status: 409,
        data: {
          errorCode: 'WORK_INSTRUCTION_MEMO_FINGERPRINT_CONFLICT',
          message: 'memoの原本が保存中に変更されました'
        }
      }
    });
    await act(async () => {
      await hook.result.current.retryConflictSave();
    });

    expect(hook.result.current.conflict).toBeNull();
    expect(hook.result.current.message).toBe('memoの原本が保存中に変更されました');
  });

  it('preserves a memo migration resolution message on a save 409 without entering conflict recovery', async () => {
    const hook = renderEditor();
    await authenticate(hook);
    act(() => hook.result.current.updateMemo(hook.result.current.selectedStepKey!, '変更したmemo'));
    await waitFor(() => expect(hook.result.current.isDirty).toBe(true));
    apiMocks.save.mockRejectedValueOnce({
      response: {
        status: 409,
        data: {
          errorCode: 'WORK_INSTRUCTION_MEMO_MIGRATION_RESOLUTION_REQUIRED',
          message: '保存前にmemoの移植状態をKEEPまたはUSE_SOURCEで解決してください'
        }
      }
    });

    await act(async () => {
      await hook.result.current.save();
    });

    expect(hook.result.current.message).toBe('保存前にmemoの移植状態をKEEPまたはUSE_SOURCEで解決してください');
    expect(hook.result.current.conflict).toBeNull();
  });

  it('re-composes source-step buckets when a save response omits derived revision steps', async () => {
    const hook = renderEditor();
    await authenticate(hook);
    act(() => hook.result.current.setPendingRange(range));
    await act(async () => {
      await hook.result.current.createOverlay('SHAPE');
    });
    const localElements = hook.result.current.activeElements;
    apiMocks.save.mockResolvedValueOnce({
      ...makeDraft(localElements, 1),
      steps: [],
      overlays: localElements
    });

    await act(async () => {
      await hook.result.current.save();
    });

    expect(hook.result.current.activeRevision?.steps[0]?.overlays).toEqual(localElements);
    expect(hook.result.current.activeElements).toEqual(localElements);
  });

  it('keeps an empty memo override dirty, saves it atomically, and deletes it on reset', async () => {
    const hook = renderEditor();
    await authenticate(hook);
    const stepKey = hook.result.current.selectedStepKey;
    expect(stepKey).toBe('sharepoint:work-instructions:1:1');

    act(() => hook.result.current.updateMemo(stepKey!, ''));
    await waitFor(() => {
      expect(hook.result.current.activeMemo).toBe('');
      expect(hook.result.current.activeMemoOverride).toMatchObject({ stepKey, text: '' });
      expect(hook.result.current.isDirty).toBe(true);
    });

    apiMocks.save.mockResolvedValueOnce(makeDraft([], 1, [{ stepKey: stepKey!, text: '', action: 'AUTO' }]));
    await act(async () => {
      await hook.result.current.save();
    });
    expect(apiMocks.save).toHaveBeenLastCalledWith(expect.objectContaining({
      memoOverrides: [expect.objectContaining({ stepKey, text: '', action: 'AUTO' })]
    }));
    await waitFor(() => expect(hook.result.current.isDirty).toBe(false));

    act(() => hook.result.current.resetMemo(stepKey!));
    await waitFor(() => {
      expect(hook.result.current.activeMemo).toBe('加工面を確認します。');
      expect(hook.result.current.activeMemoOverride).toBeNull();
      expect(hook.result.current.isDirty).toBe(true);
    });

    apiMocks.save.mockResolvedValueOnce(makeDraft([], 2));
    await act(async () => {
      await hook.result.current.save();
    });
    expect(apiMocks.save).toHaveBeenLastCalledWith(expect.objectContaining({
      memoOverrides: [expect.objectContaining({
        stepKey,
        sourceStep: 1,
        action: 'USE_SOURCE',
        text: ''
      })]
    }));
  });

  it('keeps a NEEDS_REVIEW memo only after recording the current target fingerprint', async () => {
    const reviewMemo: WorkInstructionMemoOverrideDto = {
      stepKey: 'sharepoint:work-instructions:1:1',
      text: '旧原本に合わせたメモ',
      migrationState: 'NEEDS_REVIEW',
      targetStepFingerprint: 'old-hash'
    };
    const draft = makeDraft([], 0, [reviewMemo]);
    apiMocks.copy.mockResolvedValueOnce({ group: makeGroup(draft), revisions: [draft] });
    const hook = renderEditor();
    await authenticate(hook);

    expect(hook.result.current.activeMemo).toBe('旧原本に合わせたメモ');
    expect(hook.result.current.activeMemoOverride).toMatchObject({ migrationState: 'NEEDS_REVIEW' });
    act(() => hook.result.current.keepMemo(hook.result.current.selectedStepKey!));

    await waitFor(() => expect(hook.result.current.activeMemoOverride).toMatchObject({
      migrationState: 'MIGRATED',
      targetStepFingerprint: 'old-hash',
      expectedTargetStepFingerprint: 'old-hash',
      action: 'KEEP'
    }));

    apiMocks.save.mockResolvedValueOnce(makeDraft([], 1, [{
      ...reviewMemo,
      migrationState: 'MIGRATED',
      action: 'KEEP',
      expectedTargetStepFingerprint: 'old-hash'
    }]));
    await act(async () => {
      await hook.result.current.save();
    });
    expect(apiMocks.save).toHaveBeenLastCalledWith(expect.objectContaining({
      memoOverrides: [expect.objectContaining({
        text: '旧原本に合わせたメモ',
        action: 'KEEP',
        expectedTargetStepFingerprint: 'old-hash'
      })]
    }));
  });

  it('preserves the memo migration resolution message for a publish 409', async () => {
    const hook = renderEditor();
    await authenticate(hook);
    apiMocks.publish.mockRejectedValueOnce({
      response: {
        status: 409,
        data: {
          errorCode: 'WORK_INSTRUCTION_MEMO_MIGRATION_RESOLUTION_REQUIRED',
          message: 'memoの移植状態をKEEPまたはUSE_SOURCEで解決してから公開してください'
        }
      }
    });

    await act(async () => {
      await hook.result.current.publish();
    });

    expect(hook.result.current.message).toBe('memoの移植状態をKEEPまたはUSE_SOURCEで解決してから公開してください');
    expect(hook.result.current.conflict).toBeNull();
  });

  it('keeps the generic publish conflict message for an ordinary 409', async () => {
    const hook = renderEditor();
    await authenticate(hook);
    apiMocks.publish.mockRejectedValueOnce({
      response: { status: 409, data: { message: '競合の内部メッセージ' } }
    });

    await act(async () => {
      await hook.result.current.publish();
    });

    expect(hook.result.current.message).toBe('公開前に原本または下書きが更新されました。最新内容を確認して再度保存・公開してください。');
  });

  it('reassigns an unassigned memo with KEEP and sends USE_SOURCE for discard', async () => {
    const unassigned: WorkInstructionMemoOverrideDto = {
      id: 'memo-unassigned',
      stepKey: null,
      migratedFromStepKey: 'sharepoint:work-instructions:1:3',
      migratedFromStep: 3,
      sourceStep: null,
      text: '未割当メモ',
      migrationState: 'UNASSIGNED'
    };
    const draft = makeDraft([], 0, [unassigned]);
    apiMocks.copy.mockResolvedValueOnce({ group: makeGroup(draft), revisions: [draft] });
    const hook = renderEditor();
    await authenticate(hook);

    const orphanId = unassigned.id!;
    const orphanLineage = 'sharepoint:work-instructions:1:3';
    expect(hook.result.current.activeMemoOverridesArray).toEqual([expect.objectContaining({
      stepKey: null,
      migratedFromStepKey: orphanLineage,
      text: '未割当メモ'
    })]);
    act(() => hook.result.current.assignMemoAndKeep(orphanId, 'sharepoint:work-instructions:1:1'));
    await waitFor(() => expect(hook.result.current.activeMemoOverridesArray).toEqual([expect.objectContaining({
      stepKey: 'sharepoint:work-instructions:1:1',
      sourceStep: 1,
      migratedFromStep: 3,
      action: 'KEEP',
      text: '未割当メモ'
    })]));

    apiMocks.save.mockResolvedValueOnce(makeDraft([], 1, []));
    await act(async () => {
      await hook.result.current.save();
    });
    expect(apiMocks.save).toHaveBeenLastCalledWith(expect.objectContaining({
      memoOverrides: [expect.objectContaining({
        id: orphanId,
        stepKey: 'sharepoint:work-instructions:1:1',
        migratedFromStep: 3,
        action: 'KEEP',
        expectedTargetStepFingerprint: 'target-memo-fingerprint',
        text: '未割当メモ'
      })]
    }));

    const discardDraft = makeDraft([], 0, [unassigned]);
    apiMocks.copy.mockResolvedValueOnce({ group: makeGroup(discardDraft), revisions: [discardDraft] });
    const discardHook = renderEditor();
    await authenticate(discardHook);
    act(() => discardHook.result.current.useSourceMemo(orphanId));
    await waitFor(() => expect(discardHook.result.current.activeMemoOverridesArray).toEqual([expect.objectContaining({
      stepKey: null,
      migratedFromStepKey: orphanLineage,
      action: 'USE_SOURCE',
      text: ''
    })]));
    apiMocks.save.mockResolvedValueOnce(makeDraft([], 1, []));
    await act(async () => {
      await discardHook.result.current.save();
    });
    expect(apiMocks.save).toHaveBeenLastCalledWith(expect.objectContaining({
      memoOverrides: [expect.objectContaining({
        id: orphanId,
        stepKey: null,
        migratedFromStepKey: orphanLineage,
        sourceStep: null,
        action: 'USE_SOURCE',
        text: ''
      })]
    }));
  });

  it('keeps an ID-backed unassigned memo when its target already has an active override', async () => {
    const targetStepKey = 'sharepoint:work-instructions:1:1';
    const assigned: WorkInstructionMemoOverrideDto = {
      id: 'memo-assigned',
      stepKey: targetStepKey,
      sourceStep: 1,
      migratedFromStep: 1,
      text: '既存の割当済みメモ',
      migrationState: 'MIGRATED'
    };
    const unassigned: WorkInstructionMemoOverrideDto = {
      id: 'memo-unassigned',
      stepKey: null,
      migratedFromStepKey: targetStepKey,
      migratedFromStep: 1,
      sourceStep: null,
      text: '同lineageの未割当メモ',
      migrationState: 'UNASSIGNED'
    };
    const draft = makeDraft([], 0, [assigned, unassigned]);
    apiMocks.copy.mockResolvedValueOnce({ group: makeGroup(draft), revisions: [draft] });
    const hook = renderEditor();
    await authenticate(hook);

    act(() => hook.result.current.assignMemoAndKeep(unassigned.id!, targetStepKey));
    await waitFor(() => expect(hook.result.current.activeMemoOverridesArray).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: assigned.id, stepKey: targetStepKey, text: assigned.text }),
      expect.objectContaining({ id: unassigned.id, stepKey: null, text: unassigned.text, migrationState: 'UNASSIGNED' })
    ])));
  });

  it('assigns an unassigned migrated note to an explicit destination step and keeps it reviewable', async () => {
    const unassigned: WorkInstructionOverlayElement = {
      id: 'unassigned-note',
      pageIndex: 0,
      bbox: range,
      zIndex: 1,
      kind: 'TEXT',
      text: '旧版注記',
      sourceStep: null,
      migratedFromStep: 3,
      baseStepFingerprint: 'published-hash',
      targetStepFingerprint: null,
      migrationState: 'UNASSIGNED'
    };
    apiMocks.copy.mockResolvedValueOnce({
      group: makeGroup(makeDraft([unassigned])),
      revisions: [makeDraft([unassigned])]
    });
    const hook = renderEditor();
    await authenticate(hook);

    act(() => hook.result.current.setSelectedOverlayId('unassigned-note'));
    expect(hook.result.current.selectedElement).toMatchObject({
      sourceStep: null,
      stepKey: undefined,
      migrationState: 'UNASSIGNED'
    });
    act(() => hook.result.current.assignOverlayStep('unassigned-note', 'sharepoint:work-instructions:1:1'));

    expect(hook.result.current.selectedElement).toMatchObject({
      stepKey: 'sharepoint:work-instructions:1:1',
      sourceStep: 1,
      targetStepFingerprint: 'latest-hash',
      migrationState: 'NEEDS_REVIEW',
      migratedFromStep: 3
    });
  });

  it('keeps a partially deleted source version retryable and marks it deleted only after every asset succeeds', async () => {
    const sourceVersionId = 'archived-source-version';
    const partialHistory = makeHistory(sourceVersionId, true);
    const deletedHistory = makeHistory(sourceVersionId, false, '2026-08-31T01:00:00.000Z');
    const refetch = vi.fn()
      .mockResolvedValueOnce({ data: makeGroup(makeDraft(), [partialHistory]) })
      .mockResolvedValueOnce({ data: makeGroup(makeDraft(), [deletedHistory]) });
    apiMocks.useEditorGroup.mockReturnValue({
      data: makeGroup(),
      isLoading: false,
      isError: false,
      refetch
    });
    apiMocks.copy.mockResolvedValueOnce({ group: makeGroup(makeDraft(), [partialHistory]), revisions: [makeDraft()] });
    apiMocks.history
      .mockResolvedValueOnce([partialHistory])
      .mockResolvedValueOnce([deletedHistory]);
    apiMocks.deleteSourceImages
      .mockResolvedValueOnce({
        results: [
          { assetId: 'source-asset-1', auditId: 'audit-1', status: 'DELETED' },
          { assetId: 'source-asset-2', auditId: null, status: 'FAILED', error: 'storage unavailable' },
          { assetId: 'source-asset-3', auditId: null, status: 'SKIPPED', error: 'asset missing' }
        ],
        deletedCount: 1
      })
      .mockResolvedValueOnce({
        results: [
          { assetId: 'source-asset-2', auditId: 'audit-2', status: 'DELETED' }
        ],
        deletedCount: 1
      });

    const hook = renderEditor();
    await authenticate(hook);

    await act(async () => {
      await hook.result.current.deleteSourceImage(sourceVersionId);
    });
    expect(apiMocks.deleteSourceImages).toHaveBeenNthCalledWith(1, { sourceVersionId, authenticationId: 'editor-authentication-1' });
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(apiMocks.history).toHaveBeenCalledWith({ partNumber: 'PART-1', shootingTarget: '加工', authenticationId: 'editor-authentication-1' });
    expect(hook.result.current.message).toContain('1件削除しました。2件は削除できなかったため');
    expect(hook.result.current.group?.history?.[0]).toMatchObject({ canDeleteImage: true, imageDeletedAt: null });

    await act(async () => {
      await hook.result.current.deleteSourceImage(sourceVersionId);
    });
    expect(apiMocks.deleteSourceImages).toHaveBeenNthCalledWith(2, { sourceVersionId, authenticationId: 'editor-authentication-1' });
    expect(refetch).toHaveBeenCalledTimes(2);
    expect(hook.result.current.message).toContain('旧画像を1件削除しました。版履歴と監査情報は保持されています。');
    expect(hook.result.current.group?.history?.[0]).toMatchObject({ canDeleteImage: false, imageDeletedAt: '2026-08-31T01:00:00.000Z' });
  });
});
