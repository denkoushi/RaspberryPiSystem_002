import { useCallback } from 'react';

import {
  createAssemblyProcedureDocumentRevision,
  discardAssemblyProcedureDocumentRevision,
  getAssemblyProcedureDocument,
  publishAssemblyProcedureDocument,
  saveAssemblyProcedureDocumentOverlays,
  verifyAssemblyTemplateAccessPassword
} from '../../../api/client';
import { readAssemblyApiErrorMessage } from '../assemblyUiHelpers';

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
  busy: boolean;
  isDirty: boolean;
  readOnly: boolean;
  conflictEditVersion: number | null;
  setAccessGranted: StateSetter<boolean>;
  setBaselineSnapshot: StateSetter<string | null>;
  setBusy: StateSetter<boolean>;
  setConflict: StateSetter<boolean>;
  setConflictEditVersion: StateSetter<number | null>;
  setDocument: StateSetter<AssemblyProcedureDocumentDto | null>;
  setMessage: StateSetter<string | null>;
  setSelectedOverlayId: StateSetter<string | null>;
  dispatch: Dispatch<OverlayDraftAction>;
  recovery: { clear: () => void };
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

  const verifyEditorPassword = useCallback(async () => {
    const {
      busy,
      document,
      passwordInput,
      setAccessGranted,
      setBaselineSnapshot,
      setBusy,
      setConflict,
      setConflictEditVersion,
      setDocument,
      setMessage,
      dispatch
    } = session;
    if (!passwordInput.trim() || !document || busy) return;
    setBusy(true);
    setMessage(null);
    setConflict(false);
    setConflictEditVersion(null);
    try {
      const result = await verifyAssemblyTemplateAccessPassword({ password: passwordInput });
      if (!result.success) throw new Error('パスワードが正しくありません。');
      const editableDocument = await createAssemblyProcedureDocumentRevision(document.id, passwordInput);
      const nextElements = selectDocumentOverlayElements(editableDocument);
      setDocument(editableDocument);
      dispatch({ type: 'replace', elements: nextElements });
      setBaselineSnapshot(overlayDraftSnapshot(nextElements));
      setAccessGranted(true);
    } catch (error: unknown) {
      setMessage(readAssemblyApiErrorMessage(error, '認証または改版の作成に失敗しました。'));
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
      setMessage('画像オーバーレイにはasset IDを指定し、文章を空にしないでください。');
      return;
    }
    setBusy(true);
    setMessage(null);
    setConflict(false);
    try {
      const saved = await saveAssemblyProcedureDocumentOverlays({
        id: document.id,
        accessPassword: passwordInput,
        expectedEditVersion: document.editVersion ?? 0,
        elements
      });
      const nextElements = selectDocumentOverlayElements(saved);
      setDocument(saved);
      dispatch({ type: 'replace', elements: nextElements });
      setBaselineSnapshot(overlayDraftSnapshot(nextElements));
      recovery.clear();
      setMessage('オーバーレイを保存しました。');
    } catch (error: unknown) {
      const conflict = readDocumentEditorConflict(error);
      if (conflict) {
        setConflict(true);
        setConflictEditVersion(conflict.currentEditVersion);
        setMessage(DOCUMENT_EDITOR_CONFLICT_MESSAGES.save);
      } else {
        setMessage(readAssemblyApiErrorMessage(error, 'オーバーレイの保存に失敗しました。'));
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
        id: document.id,
        accessPassword: passwordInput,
        expectedEditVersion: conflictEditVersion,
        elements
      });
      const nextElements = selectDocumentOverlayElements(saved);
      setDocument(saved);
      dispatch({ type: 'replace', elements: nextElements });
      setBaselineSnapshot(overlayDraftSnapshot(nextElements));
      setConflict(false);
      setConflictEditVersion(null);
      recovery.clear();
      setMessage('保持していた内容を再保存しました。');
    } catch (error: unknown) {
      const conflict = readDocumentEditorConflict(error);
      if (conflict) {
        setConflict(true);
        setConflictEditVersion(conflict.currentEditVersion);
        setMessage(DOCUMENT_EDITOR_CONFLICT_MESSAGES.retry);
      } else {
        setMessage(readAssemblyApiErrorMessage(error, '保持中の内容の再保存に失敗しました。'));
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
      setMessage(readAssemblyApiErrorMessage(error, '最新内容の再読込に失敗しました。'));
    } finally {
      setBusy(false);
    }
  }, [session]);

  const publish = useCallback(async () => {
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
    if (!document || readOnly || busy) return;
    if (isDirty) {
      setMessage('公開前に未保存の変更を保存してください。');
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const published = await publishAssemblyProcedureDocument({
        id: document.id,
        accessPassword: passwordInput,
        expectedEditVersion: document.editVersion ?? 0
      });
      setDocument(published);
      setBaselineSnapshot(overlayDraftSnapshot(elements));
      recovery.clear();
      setMessage('手順書を公開しました。');
      onNavigateAfterPublish?.(published);
    } catch (error: unknown) {
      const conflict = readDocumentEditorConflict(error);
      if (conflict) {
        setConflict(true);
        setConflictEditVersion(conflict.currentEditVersion);
        setMessage(DOCUMENT_EDITOR_CONFLICT_MESSAGES.publish);
      } else {
        setMessage(readAssemblyApiErrorMessage(error, '手順書の公開に失敗しました。'));
      }
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
        id: document.id,
        accessPassword: passwordInput,
        expectedEditVersion: document.editVersion ?? 0
      });
      recovery.clear();
      onNavigateAfterDiscard?.();
    } catch (error: unknown) {
      const conflict = readDocumentEditorConflict(error);
      if (conflict) {
        setConflict(true);
        setConflictEditVersion(conflict.currentEditVersion);
        setMessage(DOCUMENT_EDITOR_CONFLICT_MESSAGES.discard);
      } else {
        setMessage(readAssemblyApiErrorMessage(error, '改版の破棄に失敗しました。'));
      }
    } finally {
      setBusy(false);
    }
  }, [session]);

  return {
    loadDocument,
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
