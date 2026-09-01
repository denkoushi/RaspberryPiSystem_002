import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  copyWorkInstructionOverlayDraft,
  createWorkInstructionImageRegion,
  deleteWorkInstructionSourceVersionImages,
  discardWorkInstructionOverlayDraft,
  findWorkInstructionTextCandidates,
  listWorkInstructionRevisionHistory,
  publishWorkInstructionOverlayDraft,
  saveWorkInstructionOverlayDraft,
  uploadWorkInstructionOverlayImage,
  type WorkInstructionEditorGroupDto,
  type WorkInstructionEditorRowDto,
  type WorkInstructionEditorStepDto,
  type WorkInstructionEditAssetDto,
  type WorkInstructionEditRevisionDto,
  type WorkInstructionRevisionHistoryItemDto,
  type WorkInstructionTextCandidateDto
} from '../../api/client';
import { useWorkInstructionEditorGroup } from '../../api/hooks/work-instructions';
import { useUnsavedChangesGuard } from '../navigation/useUnsavedChangesGuard';

import { useWorkInstructionEditorRecovery } from './useWorkInstructionEditorRecovery';
import {
  createWorkInstructionOverlayForRange,
  isWorkInstructionOverlayDraftSaveable,
  overlayElementsForStep,
  updateWorkInstructionOverlayBBox,
  workInstructionOverlayDraftReducer,
  workInstructionOverlayDraftSnapshot
} from './workInstructionEditorDraft';
import {
  effectiveWorkInstructionMemo,
  keepWorkInstructionMemo,
  memoOverrideForStep,
  memoOverridesToArray,
  memoOverridesToMap,
  resetWorkInstructionMemo,
  updateWorkInstructionMemo,
  workInstructionMemoOverridesSnapshot,
  workInstructionStepKey,
  type WorkInstructionMemoOverrideMap
} from './workInstructionEditorMemo';

import type { WorkInstructionEditorRecoveryRecord } from './workInstructionEditorRecovery';
import type { WorkInstructionOverlayAsset, WorkInstructionOverlayElement } from '../../api/domains/work-instructions';
import type { OverlayBBox } from '@raspi-system/shared-types';

type ConflictState = { revisionId: string; currentEditVersion: number | null };

function isSourceImageDeleted(status: string): boolean {
  return status === 'DELETED';
}

function mergeSourceImageDeleteResult(
  group: WorkInstructionEditorGroupDto,
  sourceVersionId: string,
  deletedCount: number,
  unresolvedCount: number,
  deletedAt: string
): WorkInstructionEditorGroupDto {
  const fullyDeleted = unresolvedCount === 0 && deletedCount > 0;
  const updateHistory = (item: WorkInstructionRevisionHistoryItemDto) => {
    if (item.sourceVersionId !== sourceVersionId) return item;
    if (fullyDeleted) return { ...item, canDeleteImage: false, imageDeletedAt: item.imageDeletedAt ?? deletedAt };
    if (unresolvedCount > 0) return { ...item, canDeleteImage: true };
    return item;
  };
  return {
    ...group,
    history: group.history?.map(updateHistory),
    rows: group.rows.map((row) => ({
      ...row,
      history: row.history?.map(updateHistory)
    }))
  };
}

function readApiErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error !== null && 'response' in error) {
    const response = (error as { response?: { data?: { message?: unknown; error?: unknown; details?: { message?: unknown; currentEditVersion?: unknown } } } }).response;
    const message = response?.data?.message ?? response?.data?.error ?? response?.data?.details?.message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

function errorStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null || !('response' in error)) return null;
  const status = (error as { response?: { status?: unknown } }).response?.status;
  return typeof status === 'number' ? status : null;
}

function errorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('response' in error)) return null;
  const data = (error as { response?: { data?: { errorCode?: unknown } } }).response?.data;
  return typeof data?.errorCode === 'string' ? data.errorCode : null;
}

function currentEditVersionFromError(error: unknown): number | null {
  if (typeof error !== 'object' || error === null || !('response' in error)) return null;
  const data = (error as { response?: { data?: { currentEditVersion?: unknown; details?: { currentEditVersion?: unknown } } } }).response?.data;
  const value = data?.currentEditVersion ?? data?.details?.currentEditVersion;
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function editConflictVersion(error: unknown): number | null {
  if (errorCode(error) !== 'WORK_INSTRUCTION_EDIT_CONFLICT') return null;
  return currentEditVersionFromError(error);
}

function stepKeyFor(step: WorkInstructionEditorStepDto): string {
  return workInstructionStepKey(step);
}

function revisionElements(revision: WorkInstructionEditRevisionDto | null): WorkInstructionOverlayElement[] {
  if (!revision) return [];
  const steps = revision.steps ?? [];
  const elements = steps.flatMap((step, index) => (step.overlays ?? []).map((element) => ({
    ...element,
    stepKey: element.stepKey ?? stepKeyFor(step),
    pageIndex: index
  })));
  // Some API responses expose the revision overlay set at the top level. The
  // adapter accepts both forms so a partially upgraded server remains usable.
  const topLevel = revision.overlays ?? [];
  if (topLevel.length === 0) return elements;
  const known = new Set(elements.map((element) => element.id));
  return [...elements, ...topLevel.filter((element) => !known.has(element.id)).map((element) => {
    const sourceStep = element.sourceStep;
    const stepIndex = sourceStep == null ? 0 : Math.max(0, steps.findIndex((step) => step.step === sourceStep));
    const step = steps[stepIndex];
    return {
      ...element,
      pageIndex: Number.isInteger(element.pageIndex) ? element.pageIndex : stepIndex,
      // An UNASSIGNED element may be shown on the first page as a visual
      // workspace fallback, but it must not acquire that page's source step
      // until the operator explicitly chooses a destination.
      stepKey: element.stepKey ?? (sourceStep == null ? undefined : step ? stepKeyFor(step) : undefined)
    };
  })];
}

function revisionWithFallbackSteps(
  revision: WorkInstructionEditRevisionDto,
  fallbackSteps: WorkInstructionEditorStepDto[]
): WorkInstructionEditRevisionDto {
  if ((revision.steps ?? []).length > 0) return revision;
  const overlays = revision.overlays ?? [];
  return {
    ...revision,
    steps: fallbackSteps.map((step) => ({
      ...step,
      overlays: overlays.filter((element) =>
        element.sourceStep === step.step || element.stepKey === stepKeyFor(step)
      )
    }))
  };
}

function rowRevisionElements(row: WorkInstructionEditorRowDto): WorkInstructionOverlayElement[] {
  return revisionElements(row.draft);
}

function rowWithRevision(group: WorkInstructionEditorGroupDto, revision: WorkInstructionEditRevisionDto): WorkInstructionEditorGroupDto {
  return {
    ...group,
    rows: group.rows.map((row) => row.draft?.id === revision.id
      || row.draft?.sourceVersionId === revision.sourceVersionId
      || row.latest.id === revision.sourceVersionId
      || row.published.id === revision.sourceVersionId
      ? { ...row, draft: revision, updateAvailable: true }
      : row)
  };
}

function mergeCopyResult(group: WorkInstructionEditorGroupDto, revisions: WorkInstructionEditRevisionDto[]): WorkInstructionEditorGroupDto {
  return revisions.reduce((current, revision) => rowWithRevision(current, revision), group);
}

function baseSteps(row: WorkInstructionEditorRowDto): WorkInstructionEditorStepDto[] {
  return row.draft?.steps?.length ? row.draft.steps : row.latest.steps?.length ? row.latest.steps : row.published.steps;
}

function savePayloadElements(
  revision: WorkInstructionEditRevisionDto,
  elements: WorkInstructionOverlayElement[]
): WorkInstructionOverlayElement[] {
  const steps = revision.steps ?? [];
  return elements.map((element) => {
    const step = element.stepKey ? steps.find((candidate) => stepKeyFor(candidate) === element.stepKey) : undefined;
    const sourceStep = element.sourceStep ?? step?.step ?? null;
    const fallbackStep = step?.step ?? element.migratedFromStep ?? 1;
    const fingerprint = step?.contentHash ?? revision.baseContentHash ?? revision.contentHash;
    return {
      ...element,
      sourceStep,
      migratedFromStep: element.migratedFromStep ?? fallbackStep,
      baseStepFingerprint: element.baseStepFingerprint ?? fingerprint,
      targetStepFingerprint: element.targetStepFingerprint ?? (sourceStep == null ? null : fingerprint),
      migrationState: element.migrationState ?? (sourceStep == null ? 'UNASSIGNED' : 'MIGRATED')
    };
  });
}

function savePayloadMemoOverrides(
  revision: WorkInstructionEditRevisionDto,
  overrides: WorkInstructionMemoOverrideMap
) {
  const steps = revision.steps ?? [];
  return memoOverridesToArray(overrides).map((override) => {
    const step = override.stepKey ? steps.find((candidate) => stepKeyFor(candidate) === override.stepKey) : undefined;
    const sourceStep = override.sourceStep ?? step?.step ?? null;
    return {
      ...override,
      sourceStep,
      migratedFromStep: override.migratedFromStep ?? sourceStep,
      action: override.action ?? 'AUTO',
      migrationState: override.migrationState ?? (sourceStep == null ? 'UNASSIGNED' : 'MIGRATED')
    };
  });
}

export function useWorkInstructionEditorController({
  partNumber,
  shootingTarget,
  onNavigateBack
}: {
  partNumber: string;
  shootingTarget: string;
  onNavigateBack?: () => void;
}) {
  const groupQuery = useWorkInstructionEditorGroup(partNumber, shootingTarget);
  const [group, setGroup] = useState<WorkInstructionEditorGroupDto | null>(null);
  const [accessPassword, setAccessPassword] = useState('');
  const [accessGranted, setAccessGranted] = useState(false);
  const [elementsByRevision, setElementsByRevision] = useState<Record<string, WorkInstructionOverlayElement[]>>({});
  const [memoOverridesByRevision, setMemoOverridesByRevision] = useState<Record<string, WorkInstructionMemoOverrideMap>>({});
  const [assetsByRevision, setAssetsByRevision] = useState<Record<string, Record<string, WorkInstructionEditAssetDto>>>({});
  const [baselineByRevision, setBaselineByRevision] = useState<Record<string, string>>({});
  const [memoBaselineByRevision, setMemoBaselineByRevision] = useState<Record<string, string>>({});
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [selectedStepKey, setSelectedStepKey] = useState<string | null>(null);
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [pendingRange, setPendingRange] = useState<OverlayBBox | null>(null);
  const [textCandidates, setTextCandidates] = useState<WorkInstructionTextCandidateDto[]>([]);
  const [textCandidateRange, setTextCandidateRange] = useState<{ stepKey: string; bbox: OverlayBBox; overlayId?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const [loadingEditor, setLoadingEditor] = useState(false);
  const groupRef = useRef(group);
  const elementsRef = useRef(elementsByRevision);
  const memoOverridesRef = useRef(memoOverridesByRevision);
  const baselineRef = useRef(baselineByRevision);
  groupRef.current = group;
  elementsRef.current = elementsByRevision;
  memoOverridesRef.current = memoOverridesByRevision;
  baselineRef.current = baselineByRevision;

  useEffect(() => {
    if (!groupQuery.data) return;
    setGroup(groupQuery.data);
    if (!selectedRowId) setSelectedRowId(groupQuery.data.rows[0]?.rowId ?? null);
  }, [groupQuery.data, selectedRowId]);

  // Hydrate editor state only from server group changes. Local keystrokes only
  // change elementsByRevision, so they are not overwritten while editing.
  useEffect(() => {
    if (!group) return;
    const nextElements: Record<string, WorkInstructionOverlayElement[]> = {};
    const nextMemoOverrides: Record<string, WorkInstructionMemoOverrideMap> = {};
    const nextAssets: Record<string, Record<string, WorkInstructionEditAssetDto>> = {};
    const nextBaseline: Record<string, string> = {};
    const nextMemoBaseline: Record<string, string> = {};
    for (const row of group.rows) {
      if (!row.draft) continue;
      const elements = rowRevisionElements(row);
      const memoOverrides = memoOverridesToMap(row.draft.memoOverrides);
      nextElements[row.draft.id] = elements;
      nextMemoOverrides[row.draft.id] = memoOverrides;
      nextAssets[row.draft.id] = row.draft.assets ?? {};
      nextBaseline[row.draft.id] = workInstructionOverlayDraftSnapshot(elements);
      nextMemoBaseline[row.draft.id] = workInstructionMemoOverridesSnapshot(memoOverrides);
    }
    setElementsByRevision(nextElements);
    setMemoOverridesByRevision(nextMemoOverrides);
    setAssetsByRevision(nextAssets);
    setBaselineByRevision(nextBaseline);
    setMemoBaselineByRevision(nextMemoBaseline);
    setSelectedRowId((current) => current && group.rows.some((row) => row.rowId === current) ? current : group.rows[0]?.rowId ?? null);
    setSelectedStepKey((current) => {
      const row = group.rows.find((candidate) => candidate.rowId === selectedRowId) ?? group.rows[0];
      const firstStep = row ? baseSteps(row)[0] : undefined;
      return current && row && baseSteps(row).some((step) => stepKeyFor(step) === current) ? current : firstStep ? stepKeyFor(firstStep) : null;
    });
  // Group is intentionally the only dependency: this is server hydration.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group]);

  const rows = useMemo(() => group?.rows ?? [], [group?.rows]);
  const activeRow = useMemo(() => rows.find((row) => row.rowId === selectedRowId) ?? rows[0] ?? null, [rows, selectedRowId]);
  const activeRevision = activeRow?.draft ?? null;
  const activeRevisionId = activeRevision?.id ?? null;
  const activeSteps = useMemo(() => activeRow ? baseSteps(activeRow) : [], [activeRow]);
  const activeStep = useMemo(() => activeSteps.find((step) => stepKeyFor(step) === selectedStepKey) ?? activeSteps[0] ?? null, [activeSteps, selectedStepKey]);
  const activeElements = useMemo(() => activeRevisionId ? (elementsByRevision[activeRevisionId] ?? []) : [], [activeRevisionId, elementsByRevision]);
  const activeMemoOverrides = useMemo(() => activeRevisionId ? (memoOverridesByRevision[activeRevisionId] ?? {}) : {}, [activeRevisionId, memoOverridesByRevision]);
  const activeMemoOverridesArray = useMemo(() => memoOverridesToArray(activeMemoOverrides), [activeMemoOverrides]);
  const activeMemo = useMemo(() => activeStep ? effectiveWorkInstructionMemo(activeStep, activeMemoOverrides) : '', [activeMemoOverrides, activeStep]);
  const activeMemoOverride = useMemo(() => activeStep ? memoOverrideForStep(activeStep, activeMemoOverrides) : null, [activeMemoOverrides, activeStep]);
  const activeStepElements = useMemo(() => activeStep ? overlayElementsForStep(activeElements, stepKeyFor(activeStep), activeSteps.indexOf(activeStep)) : [], [activeElements, activeStep, activeSteps]);
  const selectedElement = useMemo(() => activeElements.find((element) => element.id === selectedOverlayId) ?? null, [activeElements, selectedOverlayId]);
  const dirtyRevisionIds = useMemo(() => rows.filter((row) => {
    if (!row.draft) return false;
    const revisionId = row.draft.id;
    return workInstructionOverlayDraftSnapshot(elementsByRevision[revisionId] ?? []) !== baselineByRevision[revisionId]
      || workInstructionMemoOverridesSnapshot(memoOverridesByRevision[revisionId] ?? {}) !== memoBaselineByRevision[revisionId];
  }).map((row) => row.draft!.id), [baselineByRevision, elementsByRevision, memoBaselineByRevision, memoOverridesByRevision, rows]);
  const isDirty = dirtyRevisionIds.length > 0;
  const hasUpdate = rows.some((row) => row.updateAvailable);
  const recovery = useWorkInstructionEditorRecovery({
    groupKey: `${partNumber}:${shootingTarget}`,
    revisionId: activeRevisionId,
    sourceVersionId: activeRevision?.sourceVersionId ?? null,
    sourceContentHash: activeRevision?.contentHash ?? activeRevision?.baseContentHash ?? null,
    editVersion: activeRevision?.editVersion ?? 0,
    elements: activeElements,
    memoOverrides: activeMemoOverridesArray,
    enabled: accessGranted,
    dirty: isDirty,
    onStorageError: () => setMessage('端末の下書き領域へ保存できませんでした。明示保存を行ってください。')
  });
  const { confirmNavigation } = useUnsavedChangesGuard(accessGranted && isDirty && !busy);

  const updateElements = useCallback((revisionId: string, action: Parameters<typeof workInstructionOverlayDraftReducer>[1]) => {
    setElementsByRevision((current) => ({
      ...current,
      [revisionId]: workInstructionOverlayDraftReducer(current[revisionId] ?? [], action)
    }));
  }, []);

  const setActiveElement = useCallback((element: WorkInstructionOverlayElement) => {
    if (!activeRevisionId) return;
    updateElements(activeRevisionId, { type: 'update', element });
  }, [activeRevisionId, updateElements]);

  const updateMemo = useCallback((stepKey: string, memo: string) => {
    if (!activeRevisionId) return;
    const step = activeSteps.find((candidate) => stepKeyFor(candidate) === stepKey);
    if (!step) return;
    setMemoOverridesByRevision((current) => ({
      ...current,
      [activeRevisionId]: updateWorkInstructionMemo(current[activeRevisionId] ?? {}, step, memo)
    }));
  }, [activeRevisionId, activeSteps]);

  const resetMemo = useCallback((stepKey: string) => {
    if (!activeRevisionId) return;
    const step = activeSteps.find((candidate) => stepKeyFor(candidate) === stepKey);
    if (!step) return;
    setMemoOverridesByRevision((current) => ({
      ...current,
      [activeRevisionId]: resetWorkInstructionMemo(current[activeRevisionId] ?? {}, step)
    }));
  }, [activeRevisionId, activeSteps]);

  const keepMemo = useCallback((stepKey: string) => {
    if (!activeRevisionId) return;
    const step = activeSteps.find((candidate) => stepKeyFor(candidate) === stepKey);
    if (!step) return;
    setMemoOverridesByRevision((current) => ({
      ...current,
      [activeRevisionId]: keepWorkInstructionMemo(current[activeRevisionId] ?? {}, step)
    }));
  }, [activeRevisionId, activeSteps]);

  const assignMemoAndKeep = useCallback((overrideKey: string, targetStepKey: string) => {
    if (!activeRevisionId) return;
    const targetStep = activeSteps.find((candidate) => stepKeyFor(candidate) === targetStepKey);
    if (!targetStep?.memoFingerprint) return;
    setMemoOverridesByRevision((current) => {
      const currentOverrides = current[activeRevisionId] ?? {};
      const override = currentOverrides[overrideKey];
      if (!override) return current;
      const existingTarget = Object.entries(currentOverrides).find(([key, candidate]) => key !== overrideKey && candidate.stepKey === targetStepKey)?.[1];
      if (existingTarget
        && existingTarget.sourceStep !== null
        && existingTarget.action !== 'USE_SOURCE'
        && existingTarget.action !== 'use-source'
        && String(existingTarget.migrationState ?? '').toUpperCase() !== 'UNASSIGNED') return current;
      const nextOverrides = { ...currentOverrides };
      delete nextOverrides[overrideKey];
      nextOverrides[overrideKey] = {
        ...override,
        stepKey: targetStepKey,
        sourceStep: targetStep.step,
        migratedFromStep: override.migratedFromStep ?? targetStep.step,
        action: 'KEEP',
        migrationState: 'MIGRATED',
        expectedTargetStepFingerprint: targetStep.memoFingerprint,
      };
      return { ...current, [activeRevisionId]: nextOverrides };
    });
    setSelectedStepKey(targetStepKey);
  }, [activeRevisionId, activeSteps]);

  const useSourceMemo = useCallback((overrideKey: string) => {
    if (!activeRevisionId) return;
    setMemoOverridesByRevision((current) => {
      const currentOverrides = current[activeRevisionId] ?? {};
      const override = currentOverrides[overrideKey];
      if (!override) return current;
      return {
        ...current,
        [activeRevisionId]: {
          ...currentOverrides,
          [overrideKey]: {
            ...override,
            stepKey: null,
            sourceStep: null,
            text: '',
            action: 'USE_SOURCE',
            migrationState: 'UNASSIGNED'
          }
        }
      };
    });
  }, [activeRevisionId]);

  const hydrateFromRevision = useCallback((revision: WorkInstructionEditRevisionDto) => {
    const elements = revisionElements(revision);
    const memoOverrides = memoOverridesToMap(revision.memoOverrides);
    setElementsByRevision((current) => ({ ...current, [revision.id]: elements }));
    setMemoOverridesByRevision((current) => ({ ...current, [revision.id]: memoOverrides }));
    setAssetsByRevision((current) => ({ ...current, [revision.id]: revision.assets ?? {} }));
    setBaselineByRevision((current) => ({ ...current, [revision.id]: workInstructionOverlayDraftSnapshot(elements) }));
    setMemoBaselineByRevision((current) => ({ ...current, [revision.id]: workInstructionMemoOverridesSnapshot(memoOverrides) }));
  }, []);

  // Region extraction and file upload return an asset before the revision is
  // saved. Keep its authenticated URL in a separate local projection so the
  // neutral renderer can preview the image immediately without triggering the
  // group hydration effect (which must never replace unsaved elements).
  const registerAsset = useCallback((revisionId: string, asset: WorkInstructionEditAssetDto) => {
    setAssetsByRevision((current) => ({
      ...current,
      [revisionId]: {
        ...(current[revisionId] ?? {}),
        [asset.assetId]: asset
      }
    }));
  }, []);

  const authenticate = useCallback(async () => {
    const currentGroup = groupRef.current;
    if (!accessPassword.trim() || busy || !currentGroup || currentGroup.rows.length === 0) return;
    setBusy(true);
    setLoadingEditor(true);
    setMessage(null);
    try {
      const result = await copyWorkInstructionOverlayDraft({
        partNumber,
        shootingTarget,
        accessPassword,
        rows: currentGroup.rows.map((row) => ({
          rowId: row.rowId,
          publishedSourceVersionId: row.published.id,
          latestSourceVersionId: row.latest.id
        }))
      });
      const nextGroup = result.group ?? mergeCopyResult(currentGroup, result.revisions);
      setGroup(nextGroup);
      setAccessGranted(true);
      setMessage('編集用下書きを準備しました。新しい原本の注記を確認して公開できます。');
    } catch (error: unknown) {
      setMessage(readApiErrorMessage(error, '認証または下書きの作成に失敗しました。'));
    } finally {
      setBusy(false);
      setLoadingEditor(false);
    }
  }, [accessPassword, busy, partNumber, shootingTarget]);

  const writeRevision = useCallback(async (row: WorkInstructionEditorRowDto, editVersionOverride?: number) => {
    const revision = row.draft;
    if (!revision) return revision;
    const elements = elementsRef.current[revision.id] ?? [];
    const memoOverrides = memoOverridesRef.current[revision.id] ?? {};
    const payloadElements = savePayloadElements(revision, elements);
    const payloadMemoOverrides = savePayloadMemoOverrides(revision, memoOverrides);
    if (!isWorkInstructionOverlayDraftSaveable(elements)) throw new Error('画像注記にはasset IDを指定し、文章を空にしないでください。');
    const savedRevision = await saveWorkInstructionOverlayDraft({
      revisionId: revision.id,
      accessPassword,
      expectedEditVersion: editVersionOverride ?? revision.editVersion,
      expectedSourceVersionId: revision.sourceVersionId,
      expectedContentHash: revision.contentHash || revision.baseContentHash || '',
      elements: payloadElements,
      memoOverrides: payloadMemoOverrides
    });
    const saved = revisionWithFallbackSteps(savedRevision, baseSteps(row));
    if (saved.memoOverrides === undefined) saved.memoOverrides = payloadMemoOverrides;
    hydrateFromRevision(saved);
    recovery.clear();
    return saved;
  }, [accessPassword, hydrateFromRevision, recovery]);

  const save = useCallback(async () => {
    const currentGroup = groupRef.current;
    if (!currentGroup || busy || !accessGranted || dirtyRevisionIds.length === 0) return;
    setBusy(true);
    setConflict(null);
    setMessage(null);
    let savingRevisionId = activeRevisionId ?? '';
    const savedRows: WorkInstructionEditorRowDto[] = [...currentGroup.rows];
    let hasSavedRows = false;
    try {
      for (let index = 0; index < currentGroup.rows.length; index += 1) {
        const row = currentGroup.rows[index];
        if (!row.draft || !dirtyRevisionIds.includes(row.draft.id)) {
          continue;
        }
        savingRevisionId = row.draft.id;
        const saved = await writeRevision(row);
        if (!saved) continue;
        savedRows[index] = { ...row, draft: saved };
        hasSavedRows = true;
      }
      const nextGroup = { ...currentGroup, rows: savedRows };
      setGroup(nextGroup);
      setMessage('オーバーレイを保存しました。');
    } catch (error: unknown) {
      if (hasSavedRows) setGroup({ ...currentGroup, rows: savedRows });
      const currentEditVersion = editConflictVersion(error);
      if (currentEditVersion !== null) {
        setConflict({ revisionId: savingRevisionId, currentEditVersion });
        setMessage('他の管理者が先に更新しました。保持中の内容を再保存するか、最新内容を読み込んでください。');
      } else {
        setConflict(null);
        setMessage(readApiErrorMessage(error, 'オーバーレイの保存に失敗しました。'));
      }
    } finally {
      setBusy(false);
    }
  }, [accessGranted, activeRevisionId, busy, dirtyRevisionIds, writeRevision]);

  const retryConflictSave = useCallback(async () => {
    if (!conflict || busy) return;
    const row = groupRef.current?.rows.find((candidate) => candidate.draft?.id === conflict.revisionId);
    if (!row?.draft || conflict.currentEditVersion == null) return;
    setBusy(true);
    try {
      const saved = await writeRevision(row, conflict.currentEditVersion);
      if (saved && groupRef.current) setGroup({ ...groupRef.current, rows: groupRef.current.rows.map((candidate) => candidate.draft?.id === saved.id ? { ...candidate, draft: saved } : candidate) });
      setConflict(null);
      setMessage('保持していた内容を最新editVersionへ再保存しました。');
    } catch (error: unknown) {
      const currentEditVersion = editConflictVersion(error);
      if (currentEditVersion !== null) {
        setConflict({ revisionId: conflict.revisionId, currentEditVersion });
        setMessage('再保存中にも更新競合が発生しました。もう一度再保存できます。');
      } else {
        setConflict(null);
        setMessage(readApiErrorMessage(error, '保持内容の再保存に失敗しました。'));
      }
    } finally {
      setBusy(false);
    }
  }, [busy, conflict, writeRevision]);

  const reloadConflict = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await groupQuery.refetch();
      if (result.data) {
        setGroup(result.data);
        setConflict(null);
        setSelectedOverlayId(null);
        setMessage('最新の原本と下書きを読み込みました。保持中の未保存内容は破棄されています。');
      }
    } catch (error: unknown) {
      setMessage(readApiErrorMessage(error, '最新内容の読み込みに失敗しました。'));
    } finally {
      setBusy(false);
    }
  }, [busy, groupQuery]);

  const publish = useCallback(async (confirmUnassigned = false) => {
    const currentGroup = groupRef.current;
    if (!currentGroup || busy || !accessGranted) return;
    setBusy(true);
    setMessage(null);
    const savedRows = [...currentGroup.rows];
    let hasSavedRows = false;
    try {
      for (let index = 0; index < savedRows.length; index += 1) {
        const row = savedRows[index];
        if (!row.draft) continue;
        if (dirtyRevisionIds.includes(row.draft.id)) {
          const saved = await writeRevision(row);
          if (saved) {
            savedRows[index] = { ...row, draft: saved };
            hasSavedRows = true;
          }
        }
      }
      const revisionIds = savedRows.map((row) => row.draft?.id).filter((id): id is string => Boolean(id));
      if (revisionIds.length === 0) throw new Error('公開できる下書きがありません。');
      const expectedEditVersions = Object.fromEntries(savedRows.flatMap((row) => row.draft ? [[row.draft.id, row.draft.editVersion]] : []));
      const published = await publishWorkInstructionOverlayDraft({ partNumber, shootingTarget, revisionIds, accessPassword, expectedEditVersions, confirmUnassigned });
      setGroup(published);
      setConflict(null);
      setMessage('加工要領書を公開しました。使用側の表示を更新できます。');
    } catch (error: unknown) {
      if (hasSavedRows) setGroup({ ...currentGroup, rows: savedRows });
      if (errorCode(error) === 'WORK_INSTRUCTION_MEMO_MIGRATION_RESOLUTION_REQUIRED') {
        setMessage(readApiErrorMessage(error, '公開前にmemoの移植状態をKEEPまたはUSE_SOURCE、または割当で解決してください。'));
      } else if (errorStatus(error) === 409) {
        setMessage('公開前に原本または下書きが更新されました。最新内容を確認して再度保存・公開してください。');
      } else setMessage(readApiErrorMessage(error, '加工要領書の公開に失敗しました。'));
    } finally {
      setBusy(false);
    }
  }, [accessGranted, busy, dirtyRevisionIds, partNumber, shootingTarget, accessPassword, writeRevision]);

  const discard = useCallback(async () => {
    const currentGroup = groupRef.current;
    if (!currentGroup || busy || !accessGranted) return;
    setBusy(true);
    try {
      const nextRows: WorkInstructionEditorRowDto[] = [];
      for (const row of currentGroup.rows) {
        if (!row.draft) { nextRows.push(row); continue; }
        await discardWorkInstructionOverlayDraft({ revisionId: row.draft.id, accessPassword, expectedEditVersion: row.draft.editVersion });
        nextRows.push({ ...row, draft: null });
      }
      setGroup({ ...currentGroup, rows: nextRows });
      setMessage('下書きを破棄しました。公開中の注記は変更されていません。');
    } catch (error: unknown) {
      setMessage(readApiErrorMessage(error, '下書きの破棄に失敗しました。'));
    } finally {
      setBusy(false);
    }
  }, [accessGranted, accessPassword, busy]);

  const addElement = useCallback((element: WorkInstructionOverlayElement) => {
    if (!activeRevisionId) return;
    updateElements(activeRevisionId, { type: 'add', element });
    setSelectedOverlayId(element.id);
  }, [activeRevisionId, updateElements]);

  const createOverlay = useCallback(async (kind: 'TEXT' | 'IMAGE' | 'SHAPE') => {
    const revisionId = activeRevisionId;
    const stepKey = activeStep ? stepKeyFor(activeStep) : null;
    if (!revisionId || !stepKey || !pendingRange || busy || !accessGranted) return;
    const range = pendingRange;
    setPendingRange(null);
    setSelectionMode(false);
    if (kind === 'SHAPE') {
      addElement(createWorkInstructionOverlayForRange(kind, activeSteps.indexOf(activeStep), stepKey, range));
      setMessage('図形・記号オーバーレイを追加しました。保存してください。');
      return;
    }
    setBusy(true);
    try {
      if (kind === 'TEXT') {
        const candidates = await findWorkInstructionTextCandidates({ revisionId, stepKey, accessPassword, bbox: range });
        if (candidates.length > 0) {
          setTextCandidates(candidates);
          setTextCandidateRange({ stepKey, bbox: range });
          setMessage('文章候補を選択してください。');
        } else {
          addElement(createWorkInstructionOverlayForRange(kind, activeSteps.indexOf(activeStep), stepKey, range));
          setMessage('文章候補が見つからないため、手入力の文章注記を追加しました。');
        }
      } else {
        const asset = await createWorkInstructionImageRegion({ revisionId, stepKey, accessPassword, bbox: range });
        registerAsset(revisionId, asset);
        addElement({ ...createWorkInstructionOverlayForRange(kind, activeSteps.indexOf(activeStep), stepKey, range), assetId: asset.assetId } as WorkInstructionOverlayElement);
        setMessage('選択範囲を画像assetとして追加しました。');
      }
    } catch (error: unknown) {
      if (kind === 'TEXT') {
        addElement(createWorkInstructionOverlayForRange(kind, activeSteps.indexOf(activeStep), stepKey, range));
        setMessage(`文章抽出に失敗したため、手入力で続行できます。${readApiErrorMessage(error, '')}`);
      } else {
        addElement(createWorkInstructionOverlayForRange(kind, activeSteps.indexOf(activeStep), stepKey, range));
        setMessage(`画像切り出しに失敗しました。画像ファイルをアップロードして続行できます。${readApiErrorMessage(error, '')}`);
      }
    } finally {
      setBusy(false);
    }
  }, [accessGranted, accessPassword, activeRevisionId, activeStep, activeSteps, addElement, busy, pendingRange, registerAsset]);

  const chooseTextCandidate = useCallback((candidate: WorkInstructionTextCandidateDto | null) => {
    if (!textCandidateRange || !activeRevisionId || !activeStep) return;
    const pageIndex = activeSteps.indexOf(activeStep);
    const bbox = candidate?.bounds ?? textCandidateRange.bbox;
    if (textCandidateRange.overlayId) {
      const current = activeElements.find((element) => element.id === textCandidateRange.overlayId);
      if (current?.kind === 'TEXT' && candidate) setActiveElement({ ...current, text: candidate.text });
    } else addElement({ ...createWorkInstructionOverlayForRange('TEXT', pageIndex, textCandidateRange.stepKey, bbox), text: candidate?.text || 'ここに文章を入力' } as WorkInstructionOverlayElement);
    setTextCandidates([]);
    setTextCandidateRange(null);
    setMessage(candidate ? '文章注記を追加しました。保存してください。' : '文章候補をキャンセルしました。');
  }, [activeElements, activeRevisionId, activeStep, activeSteps, addElement, setActiveElement, textCandidateRange]);

  const refetchTextCandidates = useCallback(async () => {
    if (!selectedElement || selectedElement.kind !== 'TEXT' || !activeRevisionId || !activeStep || busy) return;
    setBusy(true);
    try {
      const bbox = selectedElement.bbox;
      const stepKey = selectedElement.stepKey ?? stepKeyFor(activeStep);
      const candidates = await findWorkInstructionTextCandidates({ revisionId: activeRevisionId, stepKey, accessPassword, bbox });
      if (candidates.length > 0) {
        setTextCandidates(candidates);
        setTextCandidateRange({ stepKey, bbox, overlayId: selectedElement.id });
        setMessage('文章候補を選択してください。');
      } else setMessage('文章候補が見つかりません。既存文章を保持しています。');
    } catch (error: unknown) {
      setMessage(readApiErrorMessage(error, '文章候補の再取得に失敗しました。'));
    } finally {
      setBusy(false);
    }
  }, [accessPassword, activeRevisionId, activeStep, busy, selectedElement]);

  const uploadImage = useCallback(async (file: File) => {
    if (!selectedElement || selectedElement.kind !== 'IMAGE' || !activeRevisionId || !activeStep || busy) return;
    setBusy(true);
    try {
      const asset = await uploadWorkInstructionOverlayImage({ revisionId: activeRevisionId, stepKey: selectedElement.stepKey ?? stepKeyFor(activeStep), accessPassword, file });
      registerAsset(activeRevisionId, asset);
      setActiveElement({ ...selectedElement, assetId: asset.assetId });
      setMessage('画像assetを登録しました。保存してください。');
    } catch (error: unknown) {
      setMessage(readApiErrorMessage(error, '画像assetの登録に失敗しました。別の画像を選択してください。'));
    } finally {
      setBusy(false);
    }
  }, [accessPassword, activeRevisionId, activeStep, busy, registerAsset, selectedElement, setActiveElement]);

  const updateElementBBox = useCallback((id: string, bbox: OverlayBBox) => {
    const current = activeElements.find((element) => element.id === id);
    if (current) setActiveElement(updateWorkInstructionOverlayBBox(current, bbox));
  }, [activeElements, setActiveElement]);
  const updateElement = useCallback((element: WorkInstructionOverlayElement) => setActiveElement(element), [setActiveElement]);
  const assignOverlayStep = useCallback((id: string, targetStepKey: string | null) => {
    const current = activeElements.find((element) => element.id === id);
    if (!current) return;
    if (!targetStepKey) {
      setActiveElement({
        ...current,
        stepKey: undefined,
        pageIndex: 0,
        sourceStep: null,
        targetStepFingerprint: null,
        migrationState: 'UNASSIGNED'
      });
      return;
    }
    const targetStepIndex = activeSteps.findIndex((step) => stepKeyFor(step) === targetStepKey);
    const targetStep = activeSteps[targetStepIndex];
    if (!targetStep || targetStepIndex < 0) return;
    setActiveElement({
      ...current,
      stepKey: targetStepKey,
      pageIndex: targetStepIndex,
      sourceStep: targetStep.step,
      migratedFromStep: current.migratedFromStep ?? current.sourceStep ?? targetStep.step,
      targetStepFingerprint: targetStep.contentHash,
      migrationState: 'NEEDS_REVIEW'
    });
  }, [activeElements, activeSteps, setActiveElement]);
  const bringForward = useCallback((id: string) => { if (activeRevisionId) updateElements(activeRevisionId, { type: 'bringForward', id }); }, [activeRevisionId, updateElements]);
  const sendBackward = useCallback((id: string) => { if (activeRevisionId) updateElements(activeRevisionId, { type: 'sendBackward', id }); }, [activeRevisionId, updateElements]);
  const nudgeElement = useCallback((id: string, dxRatio: number, dyRatio: number) => { if (activeRevisionId) updateElements(activeRevisionId, { type: 'nudge', id, dxRatio, dyRatio }); }, [activeRevisionId, updateElements]);
  const deleteSelectedOverlay = useCallback(() => { if (activeRevisionId && selectedOverlayId) { updateElements(activeRevisionId, { type: 'remove', id: selectedOverlayId }); setSelectedOverlayId(null); } }, [activeRevisionId, selectedOverlayId, updateElements]);

  const selectRow = useCallback((rowId: string) => {
    setSelectedRowId(rowId);
    const nextRow = rows.find((row) => row.rowId === rowId);
    const firstStep = nextRow ? baseSteps(nextRow)[0] : undefined;
    setSelectedStepKey(firstStep ? stepKeyFor(firstStep) : null);
    setSelectedOverlayId(null);
    setPendingRange(null);
  }, [rows]);
  const selectStep = useCallback((stepKey: string) => { setSelectedStepKey(stepKey); setSelectedOverlayId(null); setPendingRange(null); }, []);
  const navigateBack = useCallback(() => { if (confirmNavigation()) onNavigateBack?.(); }, [confirmNavigation, onNavigateBack]);

  const restoreRecovery = useCallback(() => {
    const recovered = recovery.restore();
    if (!recovered || !activeRevisionId) return;
    setElementsByRevision((current) => ({ ...current, [activeRevisionId]: recovered.elements }));
    if (recovered.memoOverrides !== null) {
      setMemoOverridesByRevision((current) => ({
        ...current,
        [activeRevisionId]: memoOverridesToMap(recovered.memoOverrides)
      }));
    }
    setMessage('端末に残っていた下書きを復元しました。保存して確定してください。');
  }, [activeRevisionId, recovery]);

  const deleteSourceImage = useCallback(async (sourceVersionId: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await deleteWorkInstructionSourceVersionImages({ sourceVersionId, accessPassword });
      const results = result.results ?? [];
      const deletedCount = results.filter((item) => isSourceImageDeleted(item.status)).length;
      const unresolvedCount = results.length - deletedCount;
      const deletedAt = new Date().toISOString();
      let refreshedGroup: WorkInstructionEditorGroupDto | null = null;
      let refreshedHistory: WorkInstructionRevisionHistoryItemDto[] | null = null;
      let refreshFailed = false;

      // The group endpoint carries the current editor rows and the dedicated
      // history endpoint is kept in sync here as well. Either response is
      // useful when one read is temporarily unavailable, so do not turn a
      // completed per-asset delete into a false failure.
      const [groupResult, historyResult] = await Promise.allSettled([
        groupQuery.refetch(),
        listWorkInstructionRevisionHistory({ partNumber, shootingTarget })
      ]);
      if (groupResult.status === 'fulfilled') refreshedGroup = groupResult.value.data ?? null;
      else refreshFailed = true;
      if (historyResult.status === 'fulfilled') refreshedHistory = historyResult.value;
      else refreshFailed = true;

      setGroup((current) => {
        const next = refreshedGroup ?? current;
        if (!next) return current;
        const withHistory = refreshedHistory
          ? { ...next, history: refreshedHistory }
          : next;
        return mergeSourceImageDeleteResult(withHistory, sourceVersionId, deletedCount, unresolvedCount, deletedAt);
      });

      const refreshSuffix = refreshFailed ? ' 履歴の再読込に失敗したため、表示を更新できない場合は再読込してください。' : '';
      if (results.length > 0 && unresolvedCount === 0) {
        setMessage(`旧画像を${deletedCount}件削除しました。版履歴と監査情報は保持されています。${refreshSuffix}`);
      } else if (results.length > 0) {
        setMessage(`旧画像を${deletedCount}件削除しました。${unresolvedCount}件は削除できなかったため、履歴から再試行できます。${refreshSuffix}`);
      } else {
        setMessage(`削除対象の旧画像はありません。版履歴と監査情報は保持されています。${refreshSuffix}`);
      }
    } catch (error: unknown) {
      setMessage(readApiErrorMessage(error, '旧画像の削除に失敗しました。公開版を確認してから再試行してください。'));
    } finally {
      setBusy(false);
    }
  }, [accessPassword, busy, groupQuery, partNumber, shootingTarget]);

  const activeAssets = useMemo(() => {
    const assets = {
      ...(activeRevision?.assets ?? {}),
      ...(activeRevisionId ? assetsByRevision[activeRevisionId] ?? {} : {})
    };
    return assets as Record<string, WorkInstructionOverlayAsset>;
  }, [activeRevision?.assets, activeRevisionId, assetsByRevision]);

  return {
    group,
    rows,
    loading: groupQuery.isLoading || loadingEditor,
    errorMessage: groupQuery.isError ? '加工要領書を読み込めませんでした。' : null,
    accessGranted,
    busy,
    accessPassword,
    setAccessPassword,
    authenticate,
    message,
    hasUpdate,
    activeRow,
    activeRevision,
    activeStep,
    activeSteps,
    activeElements,
    activeStepElements,
    activeAssets,
    activeMemo,
    activeMemoOverride,
    activeMemoOverrides,
    activeMemoOverridesArray,
    memoOverridesByRevision,
    selectedRowId,
    selectedStepKey,
    selectedOverlayId,
    selectedElement,
    selectRow,
    selectStep,
    updateMemo,
    resetMemo,
    keepMemo,
    assignMemoAndKeep,
    useSourceMemo,
    setSelectedOverlayId,
    selectionMode,
    setSelectionMode,
    pendingRange,
    setPendingRange,
    createOverlay,
    textCandidates,
    chooseTextCandidate,
    cancelTextCandidates: () => { setTextCandidates([]); setTextCandidateRange(null); },
    refetchTextCandidates,
    uploadImage,
    updateElement,
    updateElementBBox,
    assignOverlayStep,
    bringForward,
    sendBackward,
    nudgeElement,
    deleteSelectedOverlay,
    save,
    retryConflictSave,
    reloadConflict,
    publish,
    discard,
    conflict,
    isDirty,
    canSave: isDirty && dirtyRevisionIds.every((revisionId) => isWorkInstructionOverlayDraftSaveable(elementsByRevision[revisionId] ?? [])),
    canPublish: accessGranted && rows.some((row) => row.draft != null) && !busy,
    canDiscard: accessGranted && rows.some((row) => row.draft != null) && !busy,
    navigateBack,
    confirmNavigation,
    recoveryPending: recovery.pending as WorkInstructionEditorRecoveryRecord | null,
    restoreRecovery,
    discardRecovery: recovery.discard,
    deleteSourceImage
  };
}

export type WorkInstructionEditorController = ReturnType<typeof useWorkInstructionEditorController>;
