import { useCallback, useRef, useState } from 'react';

import {
  approvePublishAssemblyProcedureDocument,
  getAssemblyProcedureDocument,
  publishAssemblyProcedureDocument,
  saveAssemblyProcedureDocumentOverlays
} from '../../../api/client';
import { kioskPinErrorResult, type KioskPinSubmitResult } from '../../kiosk/KioskPinDialog';
import { readAssemblyApiErrorMessage } from '../assemblyUiHelpers';

import {
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
  appliedCaptionElementIds?: string[];
  passwordInput: string;
  setPasswordInput: StateSetter<string>;
  busy: boolean;
  isDirty: boolean;
  readOnly: boolean;
  conflictEditVersion: number | null;
  holderToken?: string | null;
  onEditLeaseError?: (error: unknown) => boolean;
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
  onSaved?: () => void;
  releaseUnsavedMaterials?: () => Promise<void>;
  onNavigateAfterPublish?: (document: AssemblyProcedureDocumentDto) => void;
};

export function useAssemblyProcedureDocumentRevisionCommands(
  session: AssemblyProcedureDocumentRevisionCommandSession
) {
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const loadDocument = useCallback(
    (documentId: string) => getAssemblyProcedureDocument(documentId),
    []
  );

  const save = useCallback(async (flushedElements?: AssemblyProcedureOverlayElement[]) => {
    const {
      busy,
      document,
      elements: sessionElements,
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
    const elements = flushedElements ?? sessionElements;
    if (!document || readOnly || busy || savingRef.current || (!isDirty && !flushedElements)) return;
    if (!isOverlayDraftSaveable(elements)) {
      (session.setErrorMessage ?? setMessage)('画像オーバーレイにはasset IDを指定し、文章を空にしないでください。');
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setBusy(true);
    setMessage(null);
    setConflict(false);
    try {
      const saved = await saveAssemblyProcedureDocumentOverlays({
        ...(session.holderToken ? { holderToken: session.holderToken } : {}),
        id: document.id,
        accessPassword: passwordInput,
        expectedEditVersion: document.editVersion ?? 0,
        elements,
        ...(session.appliedCaptionElementIds ? { appliedCaptionElementIds: session.appliedCaptionElementIds.slice(-200) } : {})
      });
      const nextElements = selectDocumentOverlayElements(saved);
      session.onSaved?.();
      setDocument(current => {
        const variants = Object.entries(current?.assets ?? {}).filter(([, asset]) =>
          asset.derivedFromAssetId && saved.assets?.[asset.derivedFromAssetId]);
        return variants.length ? { ...saved, assets: { ...Object.fromEntries(variants), ...saved.assets } } : saved;
      });
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
      savingRef.current = false;
      setSaving(false);
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
    if (!document || readOnly || busy || savingRef.current || conflictEditVersion == null) return;
    savingRef.current = true;
    setSaving(true);
    setBusy(true);
    setMessage('保持中の内容を最新editVersionへ再保存しています…');
    try {
      const saved = await saveAssemblyProcedureDocumentOverlays({
        ...(session.holderToken ? { holderToken: session.holderToken } : {}),
        id: document.id,
        accessPassword: passwordInput,
        expectedEditVersion: conflictEditVersion,
        elements,
        ...(session.appliedCaptionElementIds ? { appliedCaptionElementIds: session.appliedCaptionElementIds.slice(-200) } : {})
      });
      const nextElements = selectDocumentOverlayElements(saved);
      session.onSaved?.();
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
      savingRef.current = false;
      setSaving(false);
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
      await session.releaseUnsavedMaterials?.();
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

  const publish = useCallback(async (approval?: { reviewerTagUid: string; comment?: string }, accessPassword?: string): Promise<boolean | KioskPinSubmitResult | void> => {
    const {
      busy,
      document,
      elements,
      isDirty,
      onNavigateAfterPublish,
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
        accessPassword: accessPassword ?? '',
        expectedEditVersion: document.editVersion ?? 0
      });
      setDocument(published);
      setBaselineSnapshot(overlayDraftSnapshot(elements));
      recovery.clear();
      setMessage('手順書を公開しました。');
      onNavigateAfterPublish?.(published);
      return true;
    } catch (error: unknown) {
      if (accessPassword !== undefined) {
        const pinResult = kioskPinErrorResult(error);
        if (pinResult === 'mismatch' || pinResult === 'rate-limited') return pinResult;
      }
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

  return {
    saving,
    loadDocument,
    save,
    retryConflictSave,
    reloadConflict,
    publish,
    canPublish: canPublishAssemblyProcedureDocument(session.document, session.isDirty)
  };
}
