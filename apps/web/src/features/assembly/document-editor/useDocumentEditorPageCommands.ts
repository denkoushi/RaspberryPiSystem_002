import { useCallback, useRef } from 'react';

import { addBlankAssemblyProcedurePage, deleteAssemblyProcedurePage, importAssemblyProcedurePages, moveAssemblyProcedurePage } from '../../../api/client';
import { readAssemblyApiErrorMessage } from '../assemblyUiHelpers';

import { moveOverlayPage, movePageIndex, overlayDraftSnapshot, removeOverlayPage, shiftOverlayPages } from './assemblyDocumentEditorDraft';
import { readDocumentEditorConflict } from './documentEditorConflict';
import { selectDocumentOverlayElements } from './documentEditorSelectors';

import type { OverlayHistory, OverlayHistoryAction } from './documentEditorHistory';
import type { InlineTextElement } from './InlineTextEditor';
import type { useAssemblyDocumentEditorRecovery } from './useAssemblyDocumentEditorRecovery';
import type { useDocumentEditorMaterialPlacements } from './useDocumentEditorMaterialPlacements';
import type { AssemblyProcedureDocumentDto } from '../types';
import type { AssemblyProcedureOverlayElement } from '@raspi-system/shared-types';
import type { Dispatch, RefObject, SetStateAction } from 'react';

type Session = {
  document: AssemblyProcedureDocumentDto | null;
  history: OverlayHistory;
  draftElements: AssemblyProcedureOverlayElement[];
  inlineDraft: InlineTextElement | null;
  baselineSnapshot: string | null;
  materials: ReturnType<typeof useDocumentEditorMaterialPlacements>;
  recovery: ReturnType<typeof useAssemblyDocumentEditorRecovery>;
  holderToken: string | null;
  passwordInput: string;
  readOnly: boolean;
  busyRef: RefObject<boolean>;
  conflict: boolean;
  isDirty: boolean;
  dispatch: Dispatch<OverlayHistoryAction>;
  setDocument: Dispatch<SetStateAction<AssemblyProcedureDocumentDto | null>>;
  setInlineDraft: Dispatch<SetStateAction<InlineTextElement | null>>;
  setBaselineSnapshot: Dispatch<SetStateAction<string | null>>;
  setSelectedPageIndex: Dispatch<SetStateAction<number>>;
  setSelectedPage: (pageIndex: number) => void;
  clearPageSelection: () => void;
  setBusy: (busy: boolean) => void;
  setMessage: (message: string | null) => void;
  setErrorMessage: (message: string) => void;
  setConflict: (conflict: boolean) => void;
  setConflictEditVersion: (editVersion: number | null) => void;
  onEditLeaseError: (error: unknown) => boolean;
};

function handlePageCommandError(session: Session, error: unknown, message: string, requireEditVersion = false) {
  if (session.onEditLeaseError(error)) return;
  const nextConflict = readDocumentEditorConflict(error);
  if (nextConflict && (!requireEditVersion || nextConflict.currentEditVersion != null)) {
    session.setConflict(true);
    session.setConflictEditVersion(nextConflict.currentEditVersion);
  }
  session.setErrorMessage(readAssemblyApiErrorMessage(error, message));
}

export function useDocumentEditorPageCommands(session: Session) {
  const latest = useRef(session);
  latest.current = session;

  const addBlankPage = useCallback(async () => {
    const currentSession = latest.current;
    const {
      document, readOnly, busyRef, conflict, holderToken, passwordInput, setBusy, setDocument,
      setSelectedPage, setMessage, isDirty, recovery
    } = currentSession;
    if (!document || readOnly || busyRef.current || conflict) return;
    setBusy(true);
    try {
      const next = await addBlankAssemblyProcedurePage({ id: document.id, holderToken, accessPassword: passwordInput, expectedEditVersion: document.editVersion ?? 0 });
      // Keep the unsaved overlay reducer and its baseline; only update pages/version.
      setDocument((current) => ({ ...next, assets: { ...next.assets, ...current?.assets } }));
      setSelectedPage(Math.max(...next.pages.map((page) => page.pageIndex)));
      setMessage('白紙ページを追加しました。');
      if (isDirty) {
        recovery.saveImmediately({ baseUpdatedAt: next.updatedAt, editVersion: next.editVersion ?? 0 });
      }
    } catch (error) {
      handlePageCommandError(currentSession, error, '白紙ページを追加できませんでした。');
    } finally { setBusy(false); }
  }, []);

  const importPages = useCallback(async (sourceDocumentId: string, sourcePageIndexes: number[], afterPageIndex: number) => {
    const currentSession = latest.current;
    const {
      document, readOnly, busyRef, conflict, holderToken, passwordInput, setBusy, setMessage, draftElements,
      inlineDraft, dispatch, setInlineDraft, setBaselineSnapshot, setDocument, setSelectedPageIndex, clearPageSelection, recovery
    } = currentSession;
    if (!document || readOnly || busyRef.current || conflict || sourcePageIndexes.length === 0) return false;
    setBusy(true); setMessage(null);
    try {
      const next = await importAssemblyProcedurePages({
        id: document.id, holderToken, accessPassword: passwordInput,
        expectedEditVersion: document.editVersion ?? 0, sourceDocumentId, sourcePageIndexes, afterPageIndex
      });
      const firstPageIndex = afterPageIndex + 1, pageCount = sourcePageIndexes.length;
      const savedElements = selectDocumentOverlayElements(next);
      const importedElements = savedElements.filter(element => element.pageIndex >= firstPageIndex && element.pageIndex < firstPageIndex + pageCount);
      const insert = (draft: AssemblyProcedureOverlayElement[]) => [
        ...shiftOverlayPages(draft, afterPageIndex, pageCount),
        ...importedElements
      ];
      const nextBaseline = overlayDraftSnapshot(savedElements);
      const nextElements = insert(draftElements);
      if (inlineDraft) dispatch({ type: 'update', element: inlineDraft });
      dispatch({ type: 'shiftPages', afterPageIndex, pageCount, importedElements });
      setInlineDraft(null);
      setBaselineSnapshot(nextBaseline);
      setDocument(current => ({ ...next, assets: { ...current?.assets, ...next.assets } }));
      setSelectedPageIndex(firstPageIndex);
      clearPageSelection();
      recovery.importPages({ baseUpdatedAt: next.updatedAt, editVersion: next.editVersion ?? 0 }, insert, nextElements, overlayDraftSnapshot(nextElements) !== nextBaseline);
      setMessage(`${pageCount}ページを入れました。`);
      return true;
    } catch (error) {
      handlePageCommandError(currentSession, error, 'ページを取り込めませんでした。');
      return false;
    } finally { setBusy(false); }
  }, []);

  const deletePage = useCallback(async (pageIndex: number) => {
    const currentSession = latest.current;
    const {
      document, readOnly, busyRef, conflict, holderToken, passwordInput, setBusy, inlineDraft, history, materials,
      setInlineDraft, dispatch, setBaselineSnapshot, setDocument, setSelectedPageIndex, clearPageSelection, recovery, setMessage
    } = currentSession;
    if (!document || readOnly || busyRef.current || conflict) return;
    setBusy(true);
    try {
      const next = await deleteAssemblyProcedurePage({ id: document.id, pageIndex, holderToken, accessPassword: passwordInput, expectedEditVersion: document.editVersion ?? 0 });
      const elements = history.present;
      const currentElements = inlineDraft ? elements.map(element => element.id === inlineDraft.id ? inlineDraft : element) : elements;
      const nextElements = removeOverlayPage(currentElements, pageIndex);
      const allElements = [...history.past.flat(), ...elements, ...history.future.flat(), ...(history.dragStart ?? []), ...currentElements];
      const survivingIds = new Set(allElements.filter(element => element.pageIndex !== pageIndex).map(element => element.id));
      const removedIds = new Set(allElements.filter(element => element.pageIndex === pageIndex && !survivingIds.has(element.id)).map(element => element.id));
      const placements = [...materials.pendingMaterials.current.values()].filter(item => !removedIds.has(item.elementId));
      void materials.removePageMaterials(removedIds);
      setInlineDraft(null);
      if (inlineDraft && inlineDraft.pageIndex !== pageIndex) dispatch({ type: 'update', element: inlineDraft });
      dispatch({ type: 'deletePage', pageIndex });
      setBaselineSnapshot(current => current === null ? null : overlayDraftSnapshot(removeOverlayPage(JSON.parse(current) as AssemblyProcedureOverlayElement[], pageIndex)));
      setDocument(current => ({ ...next, assets: { ...next.assets, ...current?.assets } }));
      setSelectedPageIndex(Math.min(pageIndex, Math.max(...next.pages.map(page => page.pageIndex))));
      clearPageSelection();
      recovery.deletePage(pageIndex, { baseUpdatedAt: next.updatedAt, editVersion: next.editVersion ?? 0 }, nextElements, placements);
      setMessage(`${pageIndex + 1}ページ目を削除しました`);
    } catch (error) {
      handlePageCommandError(currentSession, error, 'ページを削除できませんでした。', true);
    } finally { setBusy(false); }
  }, []);

  const movePage = useCallback(async (from: number, to: number) => {
    const currentSession = latest.current;
    const {
      document, readOnly, busyRef, conflict, holderToken, passwordInput, setBusy, setMessage, draftElements, baselineSnapshot,
      materials, inlineDraft, dispatch, setInlineDraft, setBaselineSnapshot, setDocument, setSelectedPageIndex, clearPageSelection, recovery
    } = currentSession;
    if (!document || readOnly || busyRef.current || conflict || from === to) return;
    setBusy(true); setMessage(null);
    try {
      const next = await moveAssemblyProcedurePage({
        id: document.id, pageIndex: from, toPageIndex: to, holderToken,
        accessPassword: passwordInput, expectedEditVersion: document.editVersion ?? 0
      });
      const nextElements = moveOverlayPage(draftElements, from, to);
      const nextBaseline = baselineSnapshot === null ? null
        : overlayDraftSnapshot(moveOverlayPage(JSON.parse(baselineSnapshot) as AssemblyProcedureOverlayElement[], from, to));
      const placements = [...materials.pendingMaterials.current.values()];
      if (inlineDraft) dispatch({ type: 'update', element: inlineDraft });
      dispatch({ type: 'movePage', from, to });
      setInlineDraft(null);
      setBaselineSnapshot(nextBaseline);
      setDocument(current => ({ ...next, assets: { ...next.assets, ...current?.assets } }));
      setSelectedPageIndex(current => movePageIndex(current, from, to));
      clearPageSelection();
      setMessage('ページを並べ替えました。');
      recovery.movePage(from, to, { baseUpdatedAt: next.updatedAt, editVersion: next.editVersion ?? 0 },
        nextElements, placements, nextBaseline !== null && overlayDraftSnapshot(nextElements) !== nextBaseline);
    } catch (error) {
      handlePageCommandError(currentSession, error, 'ページを並べ替えられませんでした。', true);
    } finally { setBusy(false); }
  }, []);

  return { addBlankPage, importPages, deletePage, movePage };
}
