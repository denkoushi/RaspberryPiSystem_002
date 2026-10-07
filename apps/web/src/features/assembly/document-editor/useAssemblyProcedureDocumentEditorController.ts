import { isAxiosError } from 'axios';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';

import { addBlankAssemblyProcedurePage, createAssemblyProcedureDocumentRevision } from '../../../api/client';
import { useUnsavedChangesGuard } from '../../navigation/useUnsavedChangesGuard';
import { createAssemblyRequestId, readAssemblyApiErrorMessage } from '../assemblyUiHelpers';
import { clearProcedureEditorAccess, readProcedureEditorAccess, subscribeProcedureEditorAccess } from '../procedureEditorAccess';

import {
  createOverlayForRange,
  isOverlayDraftSaveable,
  overlayDraftReducer,
  overlayDraftSnapshot,
  updateOverlayBBox,
  type OverlayDraftAction
} from './assemblyDocumentEditorDraft';
import { readDocumentEditorConflict } from './documentEditorConflict';
import {
  selectDocumentElement,
  selectDocumentPage,
  selectDocumentOverlayElements,
  selectDocumentPageElements,
  selectDocumentPages
} from './documentEditorSelectors';
import { useAssemblyDocumentEditorRecovery } from './useAssemblyDocumentEditorRecovery';
import { useAssemblyProcedureDocumentEditLease } from './useAssemblyProcedureDocumentEditLease';
import { useAssemblyProcedureDocumentOverlayCommands } from './useAssemblyProcedureDocumentOverlayCommands';
import { useAssemblyProcedureDocumentRevisionCommands } from './useAssemblyProcedureDocumentRevisionCommands';

import type { AssemblyProcedureDocumentDto, AssemblyProcedureTextCandidateDto } from '../types';
import type { AssemblyProcedureOverlayBBox, AssemblyProcedureOverlayElement } from '@raspi-system/shared-types';

type OverlayHistory = { past: AssemblyProcedureOverlayElement[][]; present: AssemblyProcedureOverlayElement[]; future: AssemblyProcedureOverlayElement[][]; dragStart: AssemblyProcedureOverlayElement[] | null };
function historyReducer(state: OverlayHistory, action: OverlayDraftAction | { type: 'undo' } | { type: 'redo' } | { type: 'beginDrag' } | { type: 'endDrag' }): OverlayHistory {
  if (action.type === 'beginDrag') return { ...state, dragStart: state.present };
  if (action.type === 'endDrag') {
    if (!state.dragStart) return state;
    if (overlayDraftSnapshot(state.dragStart) === overlayDraftSnapshot(state.present)) return { ...state, dragStart: null };
    return { dragStart: null, past: [...state.past.slice(-49), state.dragStart], present: state.present, future: [] };
  }
  if (action.type === 'undo') {
    if (!state.past.length) return state;
    return { dragStart: null, past: state.past.slice(0, -1), present: state.past[state.past.length - 1], future: [state.present, ...state.future] };
  }
  if (action.type === 'redo') {
    if (!state.future.length) return state;
    return { dragStart: null, past: [...state.past, state.present], present: state.future[0], future: state.future.slice(1) };
  }
  const present = overlayDraftReducer(state.present, action);
  if (action.type === 'replace' && action.preserveHistory) return { ...state, present };
  if (action.type === 'replace' || action.type === 'clear') return { dragStart: null, past: [], present, future: [] };
  if (overlayDraftSnapshot(present) === overlayDraftSnapshot(state.present)) return state;
  if (state.dragStart) return { ...state, present };
  return { dragStart: null, past: [...state.past.slice(-49), state.present], present, future: [] };
}

type ControllerInput = {
  documentId: string;
  onNavigateBack?: () => void;
  onNavigateAfterDelete?: () => void;
  onNavigateAfterDiscard?: () => void;
  onNavigateAfterPublish?: (document: AssemblyProcedureDocumentDto) => void;
};

export function useAssemblyProcedureDocumentEditorController(input: ControllerInput) {
  const [document, setDocument] = useState<AssemblyProcedureDocumentDto | null>(null);
  const [history, dispatch] = useReducer(historyReducer, { past: [], present: [], future: [], dragStart: null });
  const elements = history.present;
  const [baselineSnapshot, setBaselineSnapshot] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [accessGranted, setAccessGranted] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessageState] = useState<string | null>(null);
  const [messageIsError, setMessageIsError] = useState(false);
  const setMessage = useCallback((value: import('react').SetStateAction<string | null>) => { setMessageIsError(false); setMessageState(value); }, []);
  const setErrorMessage = useCallback((value: import('react').SetStateAction<string | null>) => { setMessageIsError(true); setMessageState(value); }, []);
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
    setErrorMessage('端末の下書き領域へ保存できませんでした。明示保存を行ってください。');
  }, [setErrorMessage]);
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
      setErrorMessage(`${lease.holderLabel}に引き継がれました。未保存の内容は端末に保持しています`);
    }
  });
  const expiryRecovery = useRef({ isDirty, document, saveRecoveryImmediately });
  expiryRecovery.current = { isDirty, document, saveRecoveryImmediately };
  const revokeAccess = useCallback(() => {
    const current = expiryRecovery.current;
    if (current.isDirty) current.saveRecoveryImmediately({ baseUpdatedAt: current.document?.updatedAt ?? null, editVersion: current.document?.editVersion ?? 0 });
    dispatch({ type: 'endDrag' });
    clearProcedureEditorAccess();
    setAccessGranted(false);
    setPasswordInput('');
  }, []);
  const handleLeaseError = editLease.handleError;
  const onEditLeaseError = useCallback((error: unknown) => {
    const status = isAxiosError(error) ? error.response?.status : undefined;
    if (status === 401 || status === 403) {
      revokeAccess();
      setErrorMessage('認証の期限が切れました。');
      return true;
    }
    return handleLeaseError(error);
  }, [handleLeaseError, revokeAccess, setErrorMessage]);
  useEffect(() => subscribeProcedureEditorAccess(() => {
    if (!readProcedureEditorAccess()) {
      revokeAccess();
      setErrorMessage('認証の期限が切れました。');
    }
  }), [revokeAccess, setErrorMessage]);
  const readOnly = !accessGranted || document?.status !== 'draft' || (!editLease.mine && !editLease.unavailable);
  const revisionSession = useMemo(() => ({
    document,
    hasAuthenticated: baselineSnapshot != null,
    elements,
    passwordInput,
    busy,
    isDirty,
    readOnly,
    conflictEditVersion,
    onEditLeaseError,
    holderToken: editLease.holderToken,
    setAccessGranted,
    revokeAccess,
    setBaselineSnapshot,
    setBusy,
    setConflict,
    setConflictEditVersion,
    setDocument,
    setMessage,
    setErrorMessage,
    setSelectedOverlayId,
    dispatch,
    recovery,
    onNavigateAfterDelete: input.onNavigateAfterDelete,
    onNavigateAfterDiscard: input.onNavigateAfterDiscard,
    onNavigateAfterPublish: input.onNavigateAfterPublish
  }), [
    busy,
    baselineSnapshot,
    conflictEditVersion,
    document,
    onEditLeaseError,
    revokeAccess,
    editLease.holderToken,
    elements,
    input.onNavigateAfterDiscard,
    input.onNavigateAfterDelete,
    input.onNavigateAfterPublish,
    isDirty,
    passwordInput,
    readOnly,
    recovery,
    setMessage,
    setErrorMessage
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
    setErrorMessage,
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
    elements,
    setMessage,
    setErrorMessage
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
      .then(async (next) => {
        if (cancelled) return;
        setDocument(next);
        setSelectedPageIndex(next.pages[0]?.pageIndex ?? 0);
        const access = readProcedureEditorAccess();
        if (!access) return;
        try {
          const editable = await createAssemblyProcedureDocumentRevision(next.id, access.pin);
          if (cancelled) return;
          const currentAccess = readProcedureEditorAccess();
          if (!currentAccess || currentAccess.expiresAt !== access.expiresAt || currentAccess.clientKey !== access.clientKey || currentAccess.pin !== access.pin) throw new Error('認証の期限が切れました。');
          const nextElements = selectDocumentOverlayElements(editable);
          setPasswordInput(access.pin);
          setDocument(editable);
          dispatch({ type: 'replace', elements: nextElements });
          setBaselineSnapshot(overlayDraftSnapshot(nextElements));
          setAccessGranted(true);
        } catch (error) {
          if (cancelled) return;
          revokeAccess();
          setErrorMessage(readAssemblyApiErrorMessage(error, '認証または改版の作成に失敗しました。'));
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) setErrorMessage(readAssemblyApiErrorMessage(error, '手順書を取得できませんでした。'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [input.documentId, loadDocument, revokeAccess, setMessage, setErrorMessage]);

  const restoreRecovery = useCallback(() => {
    const recovered = recovery.restore();
    if (!recovered) return;
    dispatch({ type: 'replace', elements: recovered });
    setMessage('端末に残っていた下書きを復元しました。保存して確定してください。');
  }, [recovery, setMessage]);

  const { confirmNavigation } = useUnsavedChangesGuard(isDirty);
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
  const bringToFront = useCallback((id: string) => {
    if (!readOnly) dispatch({ type: 'bringToFront', id });
  }, [readOnly]);
  const sendToBack = useCallback((id: string) => {
    if (!readOnly) dispatch({ type: 'sendToBack', id });
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
      setErrorMessage(readAssemblyApiErrorMessage(error, '白紙ページを追加できませんでした。'));
    } finally { setBusy(false); }
  }, [editLease.holderToken, busy, conflict, document, onEditLeaseError, isDirty, passwordInput, readOnly, saveRecoveryImmediately, setSelectedPage, setMessage, setErrorMessage]);

  const duplicateSelectedOverlay = useCallback(() => {
    if (!selectedElement || readOnly) return;
    const copy = { ...selectedElement, id: createAssemblyRequestId(), zIndex: Math.max(0, ...elements.map(element => element.zIndex)) + 1 };
    dispatch({ type: 'add', element: copy });
    setSelectedOverlayId(copy.id);
  }, [selectedElement, elements, readOnly]);
  const addOverlay = useCallback((kind: 'TEXT' | 'SHAPE') => {
    if (readOnly || busy) return;
    // Toolbar creation uses a visible starter box; range creation retains OCR/cropping.
    const element = createOverlayForRange(kind, selectedPageIndex, { xRatio: 0.25, yRatio: 0.25, widthRatio: 0.3, heightRatio: 0.15 });
    dispatch({ type: 'add', element });
    setSelectedOverlayId(element.id);
    setSelectionMode(false);
  }, [busy, readOnly, selectedPageIndex]);

  return {
    onEditLeaseError,
    beginOverlayDrag: () => { if (!readOnly) dispatch({ type: 'beginDrag' }); },
    endOverlayDrag: () => dispatch({ type: 'endDrag' }),
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    undo: () => { if (!readOnly && !busy) dispatch({ type: 'undo' }); },
    redo: () => { if (!readOnly && !busy) dispatch({ type: 'redo' }); },
    addOverlay,
    duplicateSelectedOverlay,
    addBlankPage,
    placeMaterial: overlayCommands.placeMaterial,
    replaceSelectedImageMaterial: overlayCommands.replaceSelectedImageMaterial,
    document,
    pages: selectDocumentPages(document),
    loading,
    accessGranted,
    busy,
    message,
    messageIsError,
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
    deleteDocument: revisionCommands.deleteDocument,
    navigateBack,
    isDirty,
    readOnly,
    canSave: isDirty && isOverlayDraftSaveable(elements),
    editLease: editLease.lease,
    editLeaseToken: editLease.holderToken,
    editLeaseMine: editLease.mine,
    editLeasePending: editLease.pending,
    editLeaseUnavailable: editLease.unavailable,
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
    bringToFront,
    sendToBack,
    nudgeElement,
    updateElementBBox,
    confirmNavigation,
    recoveryPending: recovery.pending,
    restoreRecovery,
    discardRecovery: recovery.discard
  };
}

export type AssemblyProcedureDocumentEditorController = ReturnType<typeof useAssemblyProcedureDocumentEditorController>;
