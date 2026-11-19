import { isAxiosError } from 'axios';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';

import { addBlankAssemblyProcedurePage, createAssemblyProcedureDocumentRevision, sharpenAssemblyProcedureOverlayImage } from '../../../api/client';
import { DEFAULT_UNSAVED_NAVIGATION_MESSAGE, useUnsavedChangesGuard } from '../../navigation/useUnsavedChangesGuard';
import { createAssemblyRequestId, readAssemblyApiErrorMessage } from '../assemblyUiHelpers';
import { clearProcedureEditorAccess, readProcedureEditorAccess, subscribeProcedureEditorAccess } from '../procedureEditorAccess';

import {
  createDuplicateOverlayAction, createOverlayForRange,
  createOverlayId,
  duplicateOverlayId,
  isOverlayDraftSaveable,
  overlayDraftSnapshot,
  shiftOverlayPages,
  updateOverlayBBox
} from './assemblyDocumentEditorDraft';
import { readDocumentEditorConflict } from './documentEditorConflict';
import { historyReducer } from './documentEditorHistory';
import { matchesMaterialPlacement, removeMaterialPlacements } from './documentEditorMaterialPlacements';
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
import { useAssemblyProcedureLayoutSuggestions } from './useAssemblyProcedureLayoutSuggestions';
import { useDocumentEditorHistoryCommands } from './useDocumentEditorHistoryCommands';
import { useDocumentEditorImageRotation } from './useDocumentEditorImageRotation';
import { useDocumentEditorMaterialPlacements } from './useDocumentEditorMaterialPlacements';
import { useDocumentEditorPageCommands } from './useDocumentEditorPageCommands';

import type { InlineTextElement, InlineTextFlush } from './InlineTextEditor';
import type { AssemblyProcedureDocumentDto, AssemblyProcedureTextCandidateDto } from '../types';
import type { AssemblyProcedureOverlayBBox, AssemblyProcedureOverlayElement } from '@raspi-system/shared-types';

// Event callbacks keep their identity while reading the latest editor state.
function useEditorCallback<Args extends unknown[], Result>(callback: (...args: Args) => Result) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  return useCallback((...args: Args) => callbackRef.current(...args), []);
}

type ControllerInput = {
  documentId: string;
  onNavigateBack?: () => void;
  onNavigateAfterPublish?: (document: AssemblyProcedureDocumentDto) => void;
};

export function useAssemblyProcedureDocumentEditorController(input: ControllerInput) {
  const [document, setDocument] = useState<AssemblyProcedureDocumentDto | null>(null);
  const [history, dispatch] = useReducer(historyReducer, { past: [], present: [], future: [], dragStart: null });
  const elements = history.present;
  const inlineTextFlush = useRef<InlineTextFlush | null>(null);
  const registerInlineTextFlush = useCallback((flush: InlineTextFlush | null) => { inlineTextFlush.current = flush; }, []);
  const flushInlineText = useEditorCallback(() => {
    const changed = inlineTextFlush.current?.();
    return changed ? elements.map(element => element.id === changed.id ? changed : element) : undefined;
  });
  const [inlineDraft, setInlineDraft] = useState<InlineTextElement | null>(null);
  const onInlineDraftChange = useEditorCallback((element: InlineTextElement | null) => { if (!busyRef.current) setInlineDraft(element); });
  const commitInlineText = useEditorCallback((element: AssemblyProcedureOverlayElement) => { if (!busyRef.current) dispatch({ type: 'update', element }); });
  const [baselineSnapshot, setBaselineSnapshot] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [accessGranted, setAccessGranted] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [busy, setBusyState] = useState(false);
  const busyRef = useRef(false);
  const setBusy = useCallback((value: import('react').SetStateAction<boolean>) => {
    busyRef.current = typeof value === 'function' ? value(busyRef.current) : value;
    setBusyState(busyRef.current);
  }, []);
  const [message, setMessageState] = useState<string | null>(null);
  const [messageIsError, setMessageIsError] = useState(false);
  const setMessage = useCallback((value: import('react').SetStateAction<string | null>) => { setMessageIsError(false); setMessageState(value); }, []);
  const setErrorMessage = useCallback((value: import('react').SetStateAction<string | null>) => { setMessageIsError(true); setMessageState(value); }, []);
  const materials = useDocumentEditorMaterialPlacements({ documentId: document?.id ?? input.documentId, elements, dispatch, setErrorMessage });
  const { pendingMaterials, materialRevision, materialScope, materialPlacements, releaseAllMaterials, beforeMaterialPlacement, cancelMaterialPlacement, trackMaterialPlacement, commitMaterialPlacements, discardMaterialPlacements } = materials;
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
  const draftElements = useMemo(() => inlineDraft ? elements.map(element => element.id === inlineDraft.id ? inlineDraft : element) : elements, [elements, inlineDraft]);
  const snapshot = useMemo(() => overlayDraftSnapshot(draftElements), [draftElements]);
  const isDirty = baselineSnapshot != null && baselineSnapshot !== snapshot;
  const selectedPage = useMemo(() => selectDocumentPage(document, selectedPageIndex), [document, selectedPageIndex]);
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
    elements: draftElements,
    materialPlacements,
    onDiscardMaterials: discardMaterialPlacements,
    enabled: accessGranted,
    dirty: isDirty,
    onStorageError
  });
  const { saveImmediately: saveRecoveryImmediately } = recovery;
  const editLease = useAssemblyProcedureDocumentEditLease({
    documentId: document?.id ?? input.documentId,
    enabled: accessGranted && document?.status === 'draft',
    onLost: (lease) => {
      const flushed = flushInlineText();
      const released = releaseAllMaterials();
      if (isDirty || flushed) saveRecoveryImmediately({ baseUpdatedAt: document?.updatedAt ?? null, editVersion: document?.editVersion ?? 0 }, removeMaterialPlacements(flushed ?? elements, released.placements), []);
      setSelectionMode(false);
      setPendingRange(null);
      setTextCandidates([]);
      setErrorMessage(`${lease.holderLabel}に引き継がれました。未保存の内容は端末に保持しています${released.placements.length ? '。置いた素材を外しました' : ''}`);
    }
  });
  const expiryRecovery = useRef({ isDirty, document, saveRecoveryImmediately });
  expiryRecovery.current = { isDirty, document, saveRecoveryImmediately };
  const revokeAccess = useCallback(() => {
    const flushed = flushInlineText();
    const current = expiryRecovery.current;
    if (current.isDirty || flushed) current.saveRecoveryImmediately({ baseUpdatedAt: current.document?.updatedAt ?? null, editVersion: current.document?.editVersion ?? 0 }, flushed);
    dispatch({ type: 'endDrag' });
    clearProcedureEditorAccess();
    setAccessGranted(false);
    setPasswordInput('');
  }, [flushInlineText]);
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
  const baseReadOnly = !accessGranted || document?.status !== 'draft' || (!editLease.mine && !editLease.unavailable);
  const layoutSuggestions = useAssemblyProcedureLayoutSuggestions({
    documentId: document?.id ?? null,
    pageIndex: selectedPageIndex,
    elements: selectedPageElements,
    accessPassword: passwordInput,
    holderToken: editLease.holderToken,
    disabled: baseReadOnly || busy || conflict || !editLease.mine,
    onStart: () => { setSelectedOverlayId(null); setSelectionMode(false); setMessage(null); },
    onApply: proposed => { dispatch({ type: 'applyLayout', pageIndex: selectedPageIndex, elements: proposed }); setMessage('整えました。元に戻せます'); },
    onApplySplit: async (proposed, nextPageElements) => {
      if (!document) return false;
      setBusy(true);
      try {
        const next = await addBlankAssemblyProcedurePage({ id: document.id, holderToken: editLease.holderToken, accessPassword: passwordInput, expectedEditVersion: document.editVersion ?? 0, afterPageIndex: selectedPageIndex });
        setDocument(current => ({ ...next, assets: { ...next.assets, ...current?.assets } }));
        setBaselineSnapshot(current => current === null ? null : overlayDraftSnapshot(shiftOverlayPages(JSON.parse(current) as AssemblyProcedureOverlayElement[], selectedPageIndex)));
        dispatch({ type: 'shiftPages', afterPageIndex: selectedPageIndex });
        dispatch({ type: 'splitLayout', pageIndex: selectedPageIndex, elements: proposed, nextPageElements });
        setMessage('2ページに分けました');
        return true;
      } catch (error) {
        const handled = onEditLeaseError(error);
        if (!handled) {
          const nextConflict = readDocumentEditorConflict(error);
          if (nextConflict) { setConflict(true); setConflictEditVersion(nextConflict.currentEditVersion); }
          setErrorMessage('ページを分けられませんでした');
        }
        return false;
      } finally { setBusy(false); }
    },
    onEditLeaseError
  });
  const readOnly = baseReadOnly || layoutSuggestions.locked;
  const revisionSession = useMemo(() => ({
    appliedCaptionElementIds: layoutSuggestions.appliedCaptionElementIds,
    document,
    hasAuthenticated: baselineSnapshot != null,
    elements,
    passwordInput,
    setPasswordInput,
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
    onSaved: commitMaterialPlacements,
    releaseUnsavedMaterials: async () => { await releaseAllMaterials().done; },
    onNavigateAfterPublish: input.onNavigateAfterPublish
  }), [
    layoutSuggestions.appliedCaptionElementIds,
    setBusy,
    busy,
    baselineSnapshot,
    conflictEditVersion,
    document,
    onEditLeaseError,
    revokeAccess,
    editLease.holderToken,
    elements,
    input.onNavigateAfterPublish,
    isDirty,
    passwordInput,
    readOnly,
    recovery,
    commitMaterialPlacements,
    releaseAllMaterials,
    setMessage,
    setErrorMessage
  ]);
  const revisionCommands = useAssemblyProcedureDocumentRevisionCommands(revisionSession);
  const { loadDocument } = revisionCommands;
  const overlaySession = useMemo(() => ({
    materialPlacementAllowed: !conflict && editLease.mine,
    materialPlacementScope: materialScope.current,
    beforeMaterialPlacement,
    cancelMaterialPlacement,
    trackMaterialPlacement,
    document,
    elements,
    passwordInput,
    get busy() { return busyRef.current; },
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
    document,
    onEditLeaseError,
    editLease.holderToken,
    passwordInput,
    pendingRange,
    readOnly,
    selectedElement,
    selectedPage,
    textCandidateRange,
    conflict,
    editLease.mine,
    elements,
    setMessage,
    setErrorMessage,
    beforeMaterialPlacement,
    cancelMaterialPlacement,
    trackMaterialPlacement,
    materialScope, setBusy
  ]);
  const overlayCommands = useAssemblyProcedureDocumentOverlayCommands(overlaySession);
  const imageRotation = useDocumentEditorImageRotation({ ...overlaySession, get busy() { return busyRef.current; }, materials });
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
    for (const placement of recovery.pending?.materialPlacements ?? []) pendingMaterials.current.set(placement.elementId, placement);
    const recovered = recovery.restore();
    if (!recovered) return;
    dispatch({ type: 'replace', elements: recovered });
    setMessage('端末に残っていた下書きを復元しました。保存して確定してください。');
  }, [recovery, setMessage, pendingMaterials]);

  const { confirmNavigation } = useUnsavedChangesGuard(isDirty);
  const confirmEditorNavigation = useEditorCallback(async () => {
    if (layoutSuggestions.locked || busyRef.current) return false;
    const flushed = flushInlineText();
    if (!(flushed && !isDirty ? window.confirm(DEFAULT_UNSAVED_NAVIGATION_MESSAGE) : confirmNavigation())) return false;
    setBusy(true);
    const released = releaseAllMaterials();
    if (isDirty || flushed) saveRecoveryImmediately({ baseUpdatedAt: document?.updatedAt ?? null, editVersion: document?.editVersion ?? 0 }, removeMaterialPlacements(flushed ?? draftElements, released.placements), []);
    if (!await released.done) window.alert('素材を未配置に戻せませんでした。素材棚で配置を取り消してください。');
    setBusy(false);
    return true;
  });
  const navigateBack = useEditorCallback(async () => {
    if (await confirmEditorNavigation()) input.onNavigateBack?.();
  });

  const handleRangeSelected = useCallback((bbox: AssemblyProcedureOverlayBBox) => {
    setPendingRange(bbox);
    setSelectionMode(false);
  }, []);
  const cancelPendingRange = useCallback(() => {
    setPendingRange(null);
    setSelectionMode(false);
  }, []);
  const setSelectedPage = useCallback((pageIndex: number) => {
    if (layoutSuggestions.locked) return;
    flushInlineText();
    setSelectedPageIndex(pageIndex);
    setSelectedOverlayId(null);
    setPendingRange(null);
  }, [layoutSuggestions.locked, flushInlineText]);

  const updateElement = useCallback((element: AssemblyProcedureOverlayElement) => {
    if (!readOnly && !busyRef.current) dispatch({ type: 'update', element });
  }, [readOnly]);
  const bringForward = useCallback((id: string) => {
    if (!readOnly && !busyRef.current) dispatch({ type: 'bringForward', id });
  }, [readOnly]);
  const sendBackward = useCallback((id: string) => {
    if (!readOnly && !busyRef.current) dispatch({ type: 'sendBackward', id });
  }, [readOnly]);
  const bringToFront = useCallback((id: string) => {
    if (!readOnly && !busyRef.current) dispatch({ type: 'bringToFront', id });
  }, [readOnly]);
  const sendToBack = useCallback((id: string) => {
    if (!readOnly && !busyRef.current) dispatch({ type: 'sendToBack', id });
  }, [readOnly]);
  const nudgeElement = useCallback((id: string, dxRatio: number, dyRatio: number) => {
    if (!readOnly && !busyRef.current) dispatch({ type: 'nudge', id, dxRatio, dyRatio });
  }, [readOnly]);
  const updateElementBBox = useEditorCallback((id: string, bbox: AssemblyProcedureOverlayBBox) => {
    if (readOnly || busyRef.current) return;
    const element = elements.find((candidate) => candidate.id === id);
    if (element) dispatch({ type: 'update', element: updateOverlayBBox(element, bbox) });
  });
  const deleteSelectedOverlay = useEditorCallback(() => {
    if (!selectedOverlayId || readOnly || busyRef.current) return;
    dispatch({ type: 'remove', id: selectedOverlayId });
    setSelectedOverlayId(null);
  });

  const clearPageSelection = () => { setSelectedOverlayId(null); setPendingRange(null); setSelectionMode(false); setTextCandidates([]); setTextCandidateRange(null); };
  const { addBlankPage, importPages, deletePage, movePage } = useDocumentEditorPageCommands({
    document, history, draftElements, inlineDraft, baselineSnapshot, materials, recovery,
    holderToken: editLease.holderToken, passwordInput, readOnly, busyRef, conflict, isDirty,
    dispatch, setDocument, setInlineDraft, setBaselineSnapshot, setSelectedPageIndex, setSelectedPage,
    clearPageSelection, setBusy, setMessage, setErrorMessage, setConflict, setConflictEditVersion, onEditLeaseError
  });

  const duplicateOverlayToCurrentPage = useEditorCallback((sourceId: string) => {
    if (readOnly || busyRef.current || !selectedPage) return;
    const source = elements.find((element) => element.id === sourceId);
    if (!source || source.pageIndex === selectedPage.pageIndex) return;
    const id = duplicateOverlayId(source.id, createOverlayId);
    const placement = pendingMaterials.current.get(sourceId);
    if (placement) pendingMaterials.current.set(id, { ...placement, elementId: id, fallbackAssetId: undefined });
    dispatch(createDuplicateOverlayAction(elements, sourceId, id, selectedPage.pageIndex));
    setSelectedOverlayId(id);
  });

  const duplicateSelectedOverlay = useEditorCallback(() => {
    if (!selectedElement || readOnly || busyRef.current) return;
    const id = duplicateOverlayId(selectedElement.id, createAssemblyRequestId);
    const placement = pendingMaterials.current.get(selectedElement.id);
    if (placement) pendingMaterials.current.set(id, { ...placement, elementId: id, fallbackAssetId: undefined });
    dispatch(createDuplicateOverlayAction(elements, selectedElement.id, id, selectedElement.pageIndex));
    setSelectedOverlayId(id);
  });
  const addOverlay = useEditorCallback((kind: 'TEXT' | 'SHAPE') => {
    if (readOnly || busyRef.current) return;
    // Toolbar creation uses a visible starter box; range creation retains OCR/cropping.
    const element = createOverlayForRange(kind, selectedPageIndex, { xRatio: 0.25, yRatio: 0.25, widthRatio: 0.3, heightRatio: 0.15 }, elements);
    dispatch({ type: 'add', element });
    setSelectedOverlayId(element.id);
    setSelectionMode(false);
  });

  const selectedImageAssetId = selectedElement?.kind === 'IMAGE' ? selectedElement.assetId : undefined;
  const originalPhotoAssetId = selectedImageAssetId ? document?.assets?.[selectedImageAssetId]?.derivedFromAssetId : undefined;
  const canTogglePhotoSharpen = Boolean(selectedImageAssetId) && !conflict;
  const isCurrentPhotoEdit = useEditorCallback((documentId: string, requestedDocumentId: string, holderToken: string | null, scope: number) =>
    document?.id === documentId && input.documentId === requestedDocumentId &&
    editLease.holderToken === holderToken && materialScope.current === scope && !readOnly && !conflict
  );
  const togglePhotoSharpen = useEditorCallback(async () => {
    if (!document || selectedElement?.kind !== 'IMAGE' || !selectedImageAssetId ||
        !canTogglePhotoSharpen || readOnly || busyRef.current) return;
    if (originalPhotoAssetId) {
      dispatch({ type: 'update', element: { ...selectedElement, assetId: originalPhotoAssetId } });
      return;
    }
    const holderToken = editLease.holderToken;
    const scope = materialScope.current;
    const requestedDocumentId = input.documentId;
    setBusy(true);
    setMessage(null);
    try {
      const asset = await sharpenAssemblyProcedureOverlayImage({
        id: document.id, assetId: selectedImageAssetId, accessPassword: passwordInput, holderToken
      });
      if (!isCurrentPhotoEdit(document.id, requestedDocumentId, holderToken, scope)) return;
      setDocument(current => current?.id === document.id
        ? { ...current, assets: { ...current.assets, [asset.assetId]: asset } } : current);
      const placement = pendingMaterials.current.get(selectedElement.id);
      if (placement && matchesMaterialPlacement(selectedElement, placement)) {
        pendingMaterials.current.set(selectedElement.id, {
          ...placement, sharpenedAssetIds: [...(placement.sharpenedAssetIds ?? []), asset.assetId]
        });
      }
      dispatch({ type: 'update', element: { ...selectedElement, assetId: asset.assetId } });
    } catch (error) {
      if (isCurrentPhotoEdit(document.id, requestedDocumentId, holderToken, scope) && !onEditLeaseError(error)) {
        const fallback = '写真をくっきりできませんでした。';
        const status = isAxiosError(error) ? error.response?.status : undefined;
        setErrorMessage(status && status < 500 ? readAssemblyApiErrorMessage(error, fallback) : fallback);
      }
    } finally {
      setBusy(false);
    }
  });

  const beginOverlayDrag = useCallback(() => { if (!readOnly && !busyRef.current) dispatch({ type: 'beginDrag' }); }, [readOnly]);
  const endOverlayDrag = useCallback(() => dispatch({ type: 'endDrag' }), []);
  const { undo, redo } = useDocumentEditorHistoryCommands({ history, dispatch, materials, document, setDocument, passwordInput, holderToken: editLease.holderToken, readOnly, materialPlacementAllowed: !conflict && editLease.mine, get busy() { return busyRef.current; }, setBusy, setErrorMessage, onEditLeaseError });
  const selectOverlay = useEditorCallback((id: string | null) => { if (!layoutSuggestions.locked) { if (id !== selectedOverlayId) flushInlineText(); setSelectedOverlayId(id); } });
  const selectMode = useCallback((value: boolean) => { if (!layoutSuggestions.locked) setSelectionMode(value); }, [layoutSuggestions.locked]);
  const save = useEditorCallback(() => revisionCommands.save(flushInlineText()));
  const refetchTextCandidates = useEditorCallback(overlayCommands.refetchTextCandidates);
  const startLayoutSuggestions = useEditorCallback(layoutSuggestions.start);

  return {
    ...(inlineDraft ? { pagePreviewElements: draftElements } : {}),
    registerInlineTextFlush,
    onInlineDraftChange,
    commitInlineText,
    setErrorMessage,
    layoutSuggestions: { ...layoutSuggestions, start: startLayoutSuggestions },
    onEditLeaseError,
    beginOverlayDrag,
    endOverlayDrag,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    undo,
    redo,
    addOverlay,
    duplicateSelectedOverlay,
    duplicateOverlayToCurrentPage,
    addBlankPage,
    importPages,
    deletePage,
    movePage,
    placeMaterial: overlayCommands.placeMaterial,
    materialRevision,
    replaceSelectedImageMaterial: overlayCommands.replaceSelectedImageMaterial,
    ...imageRotation,
    document,
    pages: selectDocumentPages(document),
    loading,
    accessGranted,
    busy,
    saving: revisionCommands.saving,
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
    setSelectedOverlayId: selectOverlay,
    selectedElement,
    canTogglePhotoSharpen,
    photoSharpened: Boolean(originalPhotoAssetId),
    togglePhotoSharpen,
    elements,
    selectionMode: selectionMode && !readOnly,
    setSelectionMode: selectMode,
    pendingRange,
    cancelPendingRange,
    createOverlay: overlayCommands.createOverlay,
    handleRangeSelected,
    updateElement,
    deleteSelectedOverlay,
    save,
    publish: revisionCommands.publish,
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
    textCandidates,
    chooseTextCandidate: overlayCommands.chooseTextCandidate,
    cancelTextCandidates: overlayCommands.cancelTextCandidates,
    refetchTextCandidates,
    uploadImage: overlayCommands.uploadImage,
    bringForward,
    sendBackward,
    bringToFront,
    sendToBack,
    nudgeElement,
    updateElementBBox,
    confirmNavigation: confirmEditorNavigation,
    recoveryPending: recovery.pending,
    restoreRecovery,
    discardRecovery: recovery.discard
  };
}

export type AssemblyProcedureDocumentEditorController = ReturnType<typeof useAssemblyProcedureDocumentEditorController>;
