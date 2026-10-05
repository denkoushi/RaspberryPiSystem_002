import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';

import { addBlankAssemblyProcedurePage } from '../../../api/client';
import { useUnsavedChangesGuard } from '../../navigation/useUnsavedChangesGuard';
import { readAssemblyApiErrorMessage } from '../assemblyUiHelpers';

import {
  isOverlayDraftSaveable,
  overlayDraftReducer,
  overlayDraftSnapshot,
  updateOverlayBBox
} from './assemblyDocumentEditorDraft';
import { readDocumentEditorConflict } from './documentEditorConflict';
import {
  selectDocumentElement,
  selectDocumentPage,
  selectDocumentPageElements,
  selectDocumentPages
} from './documentEditorSelectors';
import { useAssemblyDocumentEditorRecovery } from './useAssemblyDocumentEditorRecovery';
import { useAssemblyProcedureDocumentEditLease } from './useAssemblyProcedureDocumentEditLease';
import { useAssemblyProcedureDocumentOverlayCommands } from './useAssemblyProcedureDocumentOverlayCommands';
import { useAssemblyProcedureDocumentRevisionCommands } from './useAssemblyProcedureDocumentRevisionCommands';

import type { AssemblyProcedureDocumentDto, AssemblyProcedureTextCandidateDto } from '../types';
import type { AssemblyProcedureOverlayBBox, AssemblyProcedureOverlayElement } from '@raspi-system/shared-types';

type ControllerInput = {
  documentId: string;
  onNavigateBack?: () => void;
  onNavigateAfterDiscard?: () => void;
  onNavigateAfterPublish?: (document: AssemblyProcedureDocumentDto) => void;
};

export function useAssemblyProcedureDocumentEditorController(input: ControllerInput) {
  const [document, setDocument] = useState<AssemblyProcedureDocumentDto | null>(null);
  const [elements, dispatch] = useReducer(overlayDraftReducer, []);
  const [baselineSnapshot, setBaselineSnapshot] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [accessGranted, setAccessGranted] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedPageIndex, setSelectedPageIndex] = useState(0);
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [pendingRange, setPendingRange] = useState<AssemblyProcedureOverlayBBox | null>(null);
  const [textCandidates, setTextCandidates] = useState<AssemblyProcedureTextCandidateDto[]>([]);
  const [textCandidateRange, setTextCandidateRange] = useState<{
    pageIndex: number;
    bbox: AssemblyProcedureOverlayBBox;
    overlayId?: string;
  } | null>(null);
  const [conflict, setConflict] = useState(false);
  const [conflictEditVersion, setConflictEditVersion] = useState<number | null>(null);
  const snapshot = useMemo(() => overlayDraftSnapshot(elements), [elements]);
  const isDirty = baselineSnapshot != null && baselineSnapshot !== snapshot;
  const selectedPage = useMemo(
    () => selectDocumentPage(document, selectedPageIndex),
    [document, selectedPageIndex]
  );
  const selectedElement = useMemo(
    () => selectDocumentElement(elements, selectedOverlayId),
    [elements, selectedOverlayId]
  );
  const selectedPageElements = useMemo(
    () => selectDocumentPageElements(elements, document, selectedPageIndex),
    [document, elements, selectedPageIndex]
  );

  const onStorageError = useCallback(() => {
    setMessage('端末の下書き領域へ保存できませんでした。明示保存を行ってください。');
  }, []);
  const recovery = useAssemblyDocumentEditorRecovery({
    documentId: document?.id ?? input.documentId,
    baseUpdatedAt: document?.updatedAt ?? null,
    editVersion: document?.editVersion ?? 0,
    elements,
    enabled: accessGranted,
    dirty: isDirty,
    onStorageError
  });
  const { saveImmediately: saveRecoveryImmediately } = recovery;
  const editLease = useAssemblyProcedureDocumentEditLease({
    documentId: document?.id ?? input.documentId,
    enabled: accessGranted && document?.status === 'draft',
    onLost: (lease) => {
      if (isDirty) saveRecoveryImmediately({ baseUpdatedAt: document?.updatedAt ?? null, editVersion: document?.editVersion ?? 0 });
      setSelectionMode(false);
      setPendingRange(null);
      setTextCandidates([]);
      setMessage(`${lease.holderLabel}に引き継がれました。未保存の内容は端末に保持しています`);
    },
    onError: () => setMessage('編集の予約を確認できませんでした。予約を再取得してください。')
  });
  const { handleError: onEditLeaseError } = editLease;
  const readOnly = !accessGranted || document?.status !== 'draft' || !editLease.mine;
  const revisionSession = useMemo(() => ({
    document,
    elements,
    passwordInput,
    busy,
    isDirty,
    readOnly,
    conflictEditVersion,
    onEditLeaseError,
    holderToken: editLease.holderToken,
    setAccessGranted,
    setBaselineSnapshot,
    setBusy,
    setConflict,
    setConflictEditVersion,
    setDocument,
    setMessage,
    setSelectedOverlayId,
    dispatch,
    recovery,
    onNavigateAfterDiscard: input.onNavigateAfterDiscard,
    onNavigateAfterPublish: input.onNavigateAfterPublish
  }), [
    busy,
    conflictEditVersion,
    document,
    onEditLeaseError,
    editLease.holderToken,
    elements,
    input.onNavigateAfterDiscard,
    input.onNavigateAfterPublish,
    isDirty,
    passwordInput,
    readOnly,
    recovery
  ]);
  const revisionCommands = useAssemblyProcedureDocumentRevisionCommands(revisionSession);
  const { loadDocument } = revisionCommands;
  const overlaySession = useMemo(() => ({
    document,
    elements,
    passwordInput,
    busy,
    pendingRange,
    readOnly,
    selectedElement,
    selectedPage,
    setDocument,
    setBusy,
    setMessage,
    setPendingRange,
    setSelectionMode,
    setSelectedOverlayId,
    setTextCandidates,
    setTextCandidateRange,
    dispatch,
    textCandidateRange,
    onEditLeaseError,
    holderToken: editLease.holderToken
  }), [
    busy,
    document,
    onEditLeaseError,
    editLease.holderToken,
    passwordInput,
    pendingRange,
    readOnly,
    selectedElement,
    selectedPage,
    textCandidateRange,
    elements
  ]);
  const overlayCommands = useAssemblyProcedureDocumentOverlayCommands(overlaySession);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setAccessGranted(false);
    setMessage(null);
    setDocument(null);
    dispatch({ type: 'clear' });
    setBaselineSnapshot(null);
    setConflictEditVersion(null);
    void loadDocument(input.documentId)
      .then((next) => {
        if (cancelled) return;
        setDocument(next);
        setSelectedPageIndex(next.pages[0]?.pageIndex ?? 0);
      })
      .catch((error: unknown) => {
        if (!cancelled) setMessage(readAssemblyApiErrorMessage(error, '手順書を取得できませんでした。'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [input.documentId, loadDocument]);

  const restoreRecovery = useCallback(() => {
    const recovered = recovery.restore();
    if (!recovered) return;
    dispatch({ type: 'replace', elements: recovered });
    setMessage('端末に残っていた下書きを復元しました。保存して確定してください。');
  }, [recovery]);

  const { confirmNavigation } = useUnsavedChangesGuard(accessGranted && isDirty && !busy);
  const onNavigateBack = input.onNavigateBack;
  const navigateBack = useCallback(() => {
    if (confirmNavigation()) onNavigateBack?.();
  }, [confirmNavigation, onNavigateBack]);

  const handleRangeSelected = useCallback((bbox: AssemblyProcedureOverlayBBox) => {
    setPendingRange(bbox);
    setSelectionMode(false);
  }, []);
  const cancelPendingRange = useCallback(() => {
    setPendingRange(null);
    setSelectionMode(false);
  }, []);
  const setSelectedPage = useCallback((pageIndex: number) => {
    setSelectedPageIndex(pageIndex);
    setSelectedOverlayId(null);
    setPendingRange(null);
  }, []);

  const updateElement = useCallback((element: AssemblyProcedureOverlayElement) => {
    if (!readOnly) dispatch({ type: 'update', element });
  }, [readOnly]);
  const bringForward = useCallback((id: string) => {
    if (!readOnly) dispatch({ type: 'bringForward', id });
  }, [readOnly]);
  const sendBackward = useCallback((id: string) => {
    if (!readOnly) dispatch({ type: 'sendBackward', id });
  }, [readOnly]);
  const nudgeElement = useCallback((id: string, dxRatio: number, dyRatio: number) => {
    if (!readOnly) dispatch({ type: 'nudge', id, dxRatio, dyRatio });
  }, [readOnly]);
  const updateElementBBox = useCallback((id: string, bbox: AssemblyProcedureOverlayBBox) => {
    if (readOnly) return;
    const element = elements.find((candidate) => candidate.id === id);
    if (element) dispatch({ type: 'update', element: updateOverlayBBox(element, bbox) });
  }, [elements, readOnly]);
  const deleteSelectedOverlay = useCallback(() => {
    if (!selectedOverlayId || readOnly) return;
    dispatch({ type: 'remove', id: selectedOverlayId });
    setSelectedOverlayId(null);
  }, [readOnly, selectedOverlayId]);

  const addBlankPage = useCallback(async () => {
    if (!document || readOnly || busy || conflict) return;
    setBusy(true);
    try {
      const next = await addBlankAssemblyProcedurePage({ id: document.id, holderToken: editLease.holderToken, accessPassword: passwordInput, expectedEditVersion: document.editVersion ?? 0 });
      // Keep the unsaved overlay reducer and its baseline; only update pages/version.
      setDocument((current) => ({ ...next, assets: { ...next.assets, ...current?.assets } }));
      setSelectedPage(Math.max(...next.pages.map((page) => page.pageIndex)));
      setMessage('白紙ページを追加しました。');
      if (isDirty) {
        saveRecoveryImmediately({ baseUpdatedAt: next.updatedAt, editVersion: next.editVersion ?? 0 });
      }
    } catch (error) {
      if (onEditLeaseError(error)) return;
      const nextConflict = readDocumentEditorConflict(error);
      if (nextConflict) { setConflict(true); setConflictEditVersion(nextConflict.currentEditVersion); }
      setMessage(readAssemblyApiErrorMessage(error, '白紙ページを追加できませんでした。'));
    } finally { setBusy(false); }
  }, [editLease.holderToken, busy, conflict, document, onEditLeaseError, isDirty, passwordInput, readOnly, saveRecoveryImmediately, setSelectedPage]);

  return {
    addBlankPage,
    placeMaterial: overlayCommands.placeMaterial,
    document,
    pages: selectDocumentPages(document),
    loading,
    accessGranted,
    busy,
    message,
    conflict,
    conflictEditVersion,
    reloadConflict: revisionCommands.reloadConflict,
    retryConflictSave: revisionCommands.retryConflictSave,
    passwordInput,
    setPasswordInput,
    verifyEditorPassword: revisionCommands.verifyEditorPassword,
    selectedPageIndex,
    setSelectedPageIndex: setSelectedPage,
    selectedPage,
    selectedPageElements,
    selectedOverlayId,
    setSelectedOverlayId,
    selectedElement,
    elements,
    selectionMode: selectionMode && !readOnly,
    setSelectionMode,
    pendingRange,
    cancelPendingRange,
    createOverlay: overlayCommands.createOverlay,
    handleRangeSelected,
    updateElement,
    deleteSelectedOverlay,
    save: revisionCommands.save,
    publish: revisionCommands.publish,
    discard: revisionCommands.discard,
    navigateBack,
    isDirty,
    readOnly,
    canSave: isDirty && isOverlayDraftSaveable(elements),
    editLease: editLease.lease,
    editLeaseToken: editLease.holderToken,
    editLeaseMine: editLease.mine,
    editLeasePending: editLease.pending,
    takeoverEditLease: editLease.takeover,
    retryEditLease: editLease.retry,
    canPublish: revisionCommands.canPublish,
    canDiscard: revisionCommands.canDiscard,
    textCandidates,
    chooseTextCandidate: overlayCommands.chooseTextCandidate,
    cancelTextCandidates: overlayCommands.cancelTextCandidates,
    refetchTextCandidates: overlayCommands.refetchTextCandidates,
    uploadImage: overlayCommands.uploadImage,
    bringForward,
    sendBackward,
    nudgeElement,
    updateElementBBox,
    confirmNavigation,
    recoveryPending: recovery.pending,
    restoreRecovery,
    discardRecovery: recovery.discard
  };
}

export type AssemblyProcedureDocumentEditorController = ReturnType<typeof useAssemblyProcedureDocumentEditorController>;
