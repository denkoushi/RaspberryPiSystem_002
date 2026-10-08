import { useCallback } from 'react';

import {
  approvePublishAssemblyProcedureDocument,
  createAssemblyProcedureDocumentRevision,
  discardAssemblyProcedureDocumentRevision,
  deleteAssemblyProcedureDocument,
  getAssemblyProcedureDocument,
  publishAssemblyProcedureDocument,
  saveAssemblyProcedureDocumentOverlays,
  verifyAssemblyTemplateAccessPassword
} from '../../../api/client';
import { kioskPinErrorResult, type KioskPinSubmitResult } from '../../kiosk/KioskPinDialog';
import { readAssemblyApiErrorMessage } from '../assemblyUiHelpers';
import { clearProcedureEditorAccess, saveProcedureEditorAccess } from '../procedureEditorAccess';

import {
  canDiscardAssemblyProcedureDocumentRevision,
  canPublishAssemblyProcedureDocument,
  isOverlayDraftSaveable,
  overlayDraftSnapshot,
  type OverlayDraftAction
} from './assemblyDocumentEditorDraft';
import {
  DOCUMENT_EDITOR_CONFLICT_MESSAGES,
  readDocumentEditorConflict
} from './documentEditorConflict';
import {
  selectDocumentOverlayElements
} from './documentEditorSelectors';

import type {
  AssemblyProcedureDocumentDto
} from '../types';
import type {
  AssemblyProcedureOverlayElement
} from '@raspi-system/shared-types';
import type { Dispatch, SetStateAction } from 'react';

type StateSetter<T> = Dispatch<SetStateAction<T>>;

export type AssemblyProcedureDocumentRevisionCommandSession = {
  document: AssemblyProcedureDocumentDto | null;
  elements: AssemblyProcedureOverlayElement[];
  passwordInput: string;
  setPasswordInput: StateSetter<string>;
  busy: boolean;
  isDirty: boolean;
  readOnly: boolean;
  conflictEditVersion: number | null;
  holderToken?: string | null;
  onEditLeaseError?: (error: unknown) => boolean;
  hasAuthenticated?: boolean;
  revokeAccess?: () => void;
  setAccessGranted: StateSetter<boolean>;
  setBaselineSnapshot: StateSetter<string | null>;
  setBusy: StateSetter<boolean>;
  setConflict: StateSetter<boolean>;
  setConflictEditVersion: StateSetter<number | null>;
  setDocument: StateSetter<AssemblyProcedureDocumentDto | null>;
  setMessage: StateSetter<string | null>;
  setErrorMessage?: StateSetter<string | null>;
  setSelectedOverlayId: StateSetter<string | null>;
  dispatch: Dispatch<OverlayDraftAction>;
  recovery: { clear: () => void; saveImmediately?: (next: { baseUpdatedAt: string | null; editVersion: number }) => void };
  onNavigateAfterDelete?: () => void;
  onNavigateAfterDiscard?: () => void;
  onNavigateAfterPublish?: (document: AssemblyProcedureDocumentDto) => void;
};

export function useAssemblyProcedureDocumentRevisionCommands(
  session: AssemblyProcedureDocumentRevisionCommandSession
) {
  const loadDocument = useCallback(
    (documentId: string) => getAssemblyProcedureDocument(documentId),
    []
  );

  const verifyEditorPassword = useCallback(async (pin: string): Promise<KioskPinSubmitResult> => {
    const {
      busy,
      document,
      setPasswordInput,
      setAccessGranted,
      setBaselineSnapshot,
      setBusy,
      setConflict,
      setConflictEditVersion,
      setDocument,
      setMessage,
      dispatch
    } = session;
    if (!pin.trim()) return 'mismatch';
    if (!document || busy) return 'network';
    setBusy(true);
    setConflict(false);
    setConflictEditVersion(null);
    try {
      const result = await verifyAssemblyTemplateAccessPassword({ password: pin });
      if (!result.success) return 'mismatch';
      const editableDocument = await createAssemblyProcedureDocumentRevision(document.id, pin);
      const nextElements = selectDocumentOverlayElements(editableDocument);
      setMessage(null);
      setDocument(editableDocument);
      if (editableDocument.id === document.id && document.status === 'draft' && session.hasAuthenticated) {
        // Reauthentication keeps this document's edits and undo history.
        if ((editableDocument.editVersion ?? 0) !== (document.editVersion ?? 0)) {
          setConflict(true);
          setConflictEditVersion(editableDocument.editVersion ?? 0);
          (session.setErrorMessage ?? setMessage)(DOCUMENT_EDITOR_CONFLICT_MESSAGES.save);
        }
      } else {
        dispatch({ type: 'replace', elements: nextElements });
        setBaselineSnapshot(overlayDraftSnapshot(nextElements));
      }
      saveProcedureEditorAccess(pin);
      setPasswordInput(pin);
      setAccessGranted(true);
      return true;
    } catch (error: unknown) {
      if (session.revokeAccess) session.revokeAccess();
      else {
        if (session.isDirty) session.recovery.saveImmediately?.({ baseUpdatedAt: document.updatedAt, editVersion: document.editVersion ?? 0 });
        clearProcedureEditorAccess();
        setAccessGranted(false);
      }
      (session.setErrorMessage ?? setMessage)(readAssemblyApiErrorMessage(error, '認証または改版の作成に失敗しました。'));
      return kioskPinErrorResult(error);
    } finally {
      setBusy(false);
    }
  }, [session]);

  const save = useCallback(async () => {
    const {
      busy,
      document,
      elements,
      isDirty,
      passwordInput,
      readOnly,
      recovery,
      setBaselineSnapshot,
      setBusy,
      setConflict,
      setConflictEditVersion,
      setDocument,
      setMessage,
      dispatch
    } = session;
    if (!document || readOnly || busy || !isDirty) return;
    if (!isOverlayDraftSaveable(elements)) {
      (session.setErrorMessage ?? setMessage)('画像オーバーレイにはasset IDを指定し、文章を空にしないでください。');
      return;
    }
    setBusy(true);
    setMessage(null);
    setConflict(false);
    try {
      const saved = await saveAssemblyProcedureDocumentOverlays({
        ...(session.holderToken ? { holderToken: session.holderToken } : {}),
        id: document.id,
        accessPassword: passwordInput,
        expectedEditVersion: document.editVersion ?? 0,
        elements
      });
      const nextElements = selectDocumentOverlayElements(saved);
      setDocument(saved);
      dispatch({ type: 'replace', elements: nextElements, preserveHistory: true });
      setBaselineSnapshot(overlayDraftSnapshot(nextElements));
      recovery.clear();
      setMessage('オーバーレイを保存しました。');
    } catch (error: unknown) {
      if (session.onEditLeaseError?.(error)) return;
      const conflict = readDocumentEditorConflict(error);
      if (conflict) {
        setConflict(true);
        setConflictEditVersion(conflict.currentEditVersion);
        (session.setErrorMessage ?? setMessage)(DOCUMENT_EDITOR_CONFLICT_MESSAGES.save);
      } else {
        (session.setErrorMessage ?? setMessage)(readAssemblyApiErrorMessage(error, 'オーバーレイの保存に失敗しました。'));
      }
    } finally {
      setBusy(false);
    }
  }, [session]);

  const retryConflictSave = useCallback(async () => {
    const {
      busy,
      conflictEditVersion,
      document,
      elements,
      passwordInput,
      readOnly,
      recovery,
      setBaselineSnapshot,
      setBusy,
      setConflict,
      setConflictEditVersion,
      setDocument,
      setMessage,
      dispatch
    } = session;
    if (!document || readOnly || busy || conflictEditVersion == null) return;
    setBusy(true);
    setMessage('保持中の内容を最新editVersionへ再保存しています…');
    try {
      const saved = await saveAssemblyProcedureDocumentOverlays({
        ...(session.holderToken ? { holderToken: session.holderToken } : {}),
        id: document.id,
        accessPassword: passwordInput,
        expectedEditVersion: conflictEditVersion,
        elements
      });
      const nextElements = selectDocumentOverlayElements(saved);
      setDocument(saved);
      dispatch({ type: 'replace', elements: nextElements, preserveHistory: true });
      setBaselineSnapshot(overlayDraftSnapshot(nextElements));
      setConflict(false);
      setConflictEditVersion(null);
      recovery.clear();
      setMessage('保持していた内容を再保存しました。');
    } catch (error: unknown) {
      if (session.onEditLeaseError?.(error)) return;
      const conflict = readDocumentEditorConflict(error);
      if (conflict) {
        setConflict(true);
        setConflictEditVersion(conflict.currentEditVersion);
        (session.setErrorMessage ?? setMessage)(DOCUMENT_EDITOR_CONFLICT_MESSAGES.retry);
      } else {
        (session.setErrorMessage ?? setMessage)(readAssemblyApiErrorMessage(error, '保持中の内容の再保存に失敗しました。'));
      }
    } finally {
      setBusy(false);
    }
  }, [session]);

  const reloadConflict = useCallback(async () => {
    const {
      busy,
      document,
      recovery,
      setBaselineSnapshot,
      setBusy,
      setConflict,
      setConflictEditVersion,
      setDocument,
      setMessage,
      setSelectedOverlayId,
      dispatch
    } = session;
    if (!document || busy) return;
    setBusy(true);
    setMessage('最新の手順書を再読込しています…');
    try {
      const latest = await getAssemblyProcedureDocument(document.id);
      const nextElements = selectDocumentOverlayElements(latest);
      setDocument(latest);
      dispatch({ type: 'replace', elements: nextElements });
      setBaselineSnapshot(overlayDraftSnapshot(nextElements));
      setSelectedOverlayId(null);
      setConflict(false);
      setConflictEditVersion(null);
      recovery.clear();
      setMessage('最新内容へ置き換えました。');
    } catch (error: unknown) {
      (session.setErrorMessage ?? setMessage)(readAssemblyApiErrorMessage(error, '最新内容の再読込に失敗しました。'));
    } finally {
      setBusy(false);
    }
  }, [session]);

  const publish = useCallback(async (approval?: { reviewerTagUid: string; comment?: string }): Promise<boolean | void> => {
    const {
      busy,
      document,
      elements,
      isDirty,
      onNavigateAfterPublish,
      passwordInput,
      readOnly,
      recovery,
      setBaselineSnapshot,
      setBusy,
      setConflict,
      setConflictEditVersion,
      setDocument,
      setMessage
    } = session;
    if (!document || readOnly || busy) return false;
    if (isDirty) {
      setMessage('公開前に未保存の変更を保存してください。');
      return false;
    }
    setBusy(true);
    setMessage(null);
    try {
      const published = approval ? await approvePublishAssemblyProcedureDocument({
        ...(session.holderToken ? { holderToken: session.holderToken } : {}),
        id: document.id, ...approval, expectedEditVersion: document.editVersion ?? 0
      }) : await publishAssemblyProcedureDocument({
        ...(session.holderToken ? { holderToken: session.holderToken } : {}),
        id: document.id,
        accessPassword: passwordInput,
        expectedEditVersion: document.editVersion ?? 0
      });
      setDocument(published);
      setBaselineSnapshot(overlayDraftSnapshot(elements));
      recovery.clear();
      setMessage('手順書を公開しました。');
      onNavigateAfterPublish?.(published);
      return true;
    } catch (error: unknown) {
      if (session.onEditLeaseError?.(error)) return;
      const conflict = readDocumentEditorConflict(error);
      if (conflict) {
        setConflict(true);
        setConflictEditVersion(conflict.currentEditVersion);
        (session.setErrorMessage ?? setMessage)(DOCUMENT_EDITOR_CONFLICT_MESSAGES.publish);
      } else {
        (session.setErrorMessage ?? setMessage)(readAssemblyApiErrorMessage(error, '手順書の公開に失敗しました。'));
      }
      return false;
    } finally {
      setBusy(false);
    }
  }, [session]);

  const discard = useCallback(async () => {
    const {
      busy,
      document,
      onNavigateAfterDiscard,
      passwordInput,
      readOnly,
      recovery,
      setBusy,
      setConflict,
      setConflictEditVersion,
      setMessage
    } = session;
    if (!document || readOnly || busy || !document.supersedesDocumentId) return;
    setBusy(true);
    setMessage(null);
    try {
      await discardAssemblyProcedureDocumentRevision({
        ...(session.holderToken ? { holderToken: session.holderToken } : {}),
        id: document.id,
        accessPassword: passwordInput,
        expectedEditVersion: document.editVersion ?? 0
      });
      recovery.clear();
      onNavigateAfterDiscard?.();
    } catch (error: unknown) {
      if (session.onEditLeaseError?.(error)) return;
      const conflict = readDocumentEditorConflict(error);
      if (conflict) {
        setConflict(true);
        setConflictEditVersion(conflict.currentEditVersion);
        (session.setErrorMessage ?? setMessage)(DOCUMENT_EDITOR_CONFLICT_MESSAGES.discard);
      } else {
        (session.setErrorMessage ?? setMessage)(readAssemblyApiErrorMessage(error, '改版の破棄に失敗しました。'));
      }
    } finally {
      setBusy(false);
    }
  }, [session]);

  const deleteDocument = useCallback(async () => {
    if (!session.document || session.document.status !== 'draft' || session.document.supersedesDocumentId || session.readOnly || session.busy) return;
    session.setBusy(true);
    session.setMessage(null);
    try {
      await deleteAssemblyProcedureDocument(session.document.id, session.holderToken);
      session.recovery.clear();
      session.onNavigateAfterDelete?.();
    } catch (error: unknown) {
      if (session.onEditLeaseError?.(error)) return;
      const status = typeof error === 'object' && error !== null && 'response' in error
        ? (error as { response?: { status?: number } }).response?.status : undefined;
      const apiMessage = readAssemblyApiErrorMessage(error, '');
      (session.setErrorMessage ?? session.setMessage)(status === 409 && (!apiMessage || apiMessage.includes('割り当て')) ? '先に割り当てを外してください' : apiMessage || '要領書を削除できません');
    } finally {
      session.setBusy(false);
    }
  }, [session]);

  return {
    loadDocument,
    deleteDocument,
    verifyEditorPassword,
    save,
    retryConflictSave,
    reloadConflict,
    publish,
    discard,
    canPublish: canPublishAssemblyProcedureDocument(session.document, session.isDirty),
    canDiscard: canDiscardAssemblyProcedureDocumentRevision(session.document)
  };
}
