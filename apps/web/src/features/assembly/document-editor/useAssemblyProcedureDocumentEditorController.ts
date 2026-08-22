import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';

import { useUnsavedChangesGuard } from '../../navigation/useUnsavedChangesGuard';
import { readAssemblyApiErrorMessage } from '../assemblyUiHelpers';

import { isOverlayDraftSaveable, overlayDraftReducer, overlayDraftSnapshot } from './assemblyDocumentEditorDraft';
import {
  selectDocumentElement,
  selectDocumentPage,
  selectDocumentPageElements,
  selectDocumentPages
} from './documentEditorSelectors';
import { useAssemblyDocumentEditorRecovery } from './useAssemblyDocumentEditorRecovery';
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
  } | null>(null);
  const [conflict, setConflict] = useState(false);
  const [conflictEditVersion, setConflictEditVersion] = useState<number | null>(null);
  const snapshot = useMemo(() => overlayDraftSnapshot(elements), [elements]);
  const isDirty = baselineSnapshot != null && baselineSnapshot !== snapshot;
  const readOnly = !accessGranted || document?.status !== 'draft';
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
  const revisionSession = useMemo(() => ({
    document,
    elements,
    passwordInput,
    busy,
    isDirty,
    readOnly,
    conflictEditVersion,
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
    textCandidateRange
  }), [
    busy,
    document,
    passwordInput,
    pendingRange,
    readOnly,
    selectedElement,
    selectedPage,
    textCandidateRange
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
  const deleteSelectedOverlay = useCallback(() => {
    if (!selectedOverlayId || readOnly) return;
    dispatch({ type: 'remove', id: selectedOverlayId });
    setSelectedOverlayId(null);
  }, [readOnly, selectedOverlayId]);

  return {
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
    selectionMode,
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
    canPublish: revisionCommands.canPublish,
    canDiscard: revisionCommands.canDiscard,
    textCandidates,
    chooseTextCandidate: overlayCommands.chooseTextCandidate,
    cancelTextCandidates: overlayCommands.cancelTextCandidates,
    uploadImage: overlayCommands.uploadImage,
    bringForward,
    sendBackward,
    nudgeElement,
    confirmNavigation,
    recoveryPending: recovery.pending,
    restoreRecovery,
    discardRecovery: recovery.discard
  };
}

export type AssemblyProcedureDocumentEditorController = ReturnType<typeof useAssemblyProcedureDocumentEditorController>;
