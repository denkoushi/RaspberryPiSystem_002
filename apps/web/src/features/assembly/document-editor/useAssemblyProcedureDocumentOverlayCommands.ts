import { useCallback } from 'react';

import {
  createAssemblyProcedureImageRegion,
  findAssemblyProcedureTextCandidates,
  uploadAssemblyProcedureOverlayImage
} from '../../../api/client';
import { readAssemblyApiErrorMessage } from '../assemblyUiHelpers';

import { createOverlayForRange, type OverlayCreationKind, type OverlayDraftAction } from './assemblyDocumentEditorDraft';

import type {
  AssemblyProcedureDocumentDto,
  AssemblyProcedureTextCandidateDto
} from '../types';
import type {
  AssemblyProcedureOverlayBBox,
  AssemblyProcedureOverlayElement
} from '@raspi-system/shared-types';
import type { Dispatch, SetStateAction } from 'react';

type StateSetter<T> = Dispatch<SetStateAction<T>>;

type TextCandidateRange = {
  pageIndex: number;
  bbox: AssemblyProcedureOverlayBBox;
  overlayId?: string;
};

export type AssemblyProcedureDocumentOverlayCommandSession = {
  document: AssemblyProcedureDocumentDto | null;
  passwordInput: string;
  busy: boolean;
  pendingRange: AssemblyProcedureOverlayBBox | null;
  readOnly: boolean;
  selectedElement: AssemblyProcedureOverlayElement | null;
  selectedPage: { pageIndex: number } | null;
  setDocument: StateSetter<AssemblyProcedureDocumentDto | null>;
  setBusy: StateSetter<boolean>;
  setMessage: StateSetter<string | null>;
  setPendingRange: StateSetter<AssemblyProcedureOverlayBBox | null>;
  setSelectionMode: StateSetter<boolean>;
  setSelectedOverlayId: StateSetter<string | null>;
  setTextCandidates: StateSetter<AssemblyProcedureTextCandidateDto[]>;
  setTextCandidateRange: StateSetter<TextCandidateRange | null>;
  dispatch: Dispatch<OverlayDraftAction>;
  textCandidateRange: TextCandidateRange | null;
};

export function useAssemblyProcedureDocumentOverlayCommands(
  session: AssemblyProcedureDocumentOverlayCommandSession
) {
  const addCreatedOverlay = useCallback((
    kind: OverlayCreationKind,
    bbox: AssemblyProcedureOverlayBBox,
    options?: { text?: string; assetId?: string },
    pageIndex = session.selectedPage?.pageIndex
  ) => {
    if (pageIndex == null || session.readOnly) return null;
    const created = createOverlayForRange(kind, pageIndex, bbox);
    const element = options?.text != null && created.kind === 'TEXT'
      ? { ...created, text: options.text }
      : options?.assetId != null && created.kind === 'IMAGE'
        ? { ...created, assetId: options.assetId }
        : created;
    session.dispatch({ type: 'add', element });
    session.setSelectedOverlayId(element.id);
    return element;
  }, [session]);

  const createOverlay = useCallback(async (kind: OverlayCreationKind) => {
    const {
      busy,
      document,
      passwordInput,
      pendingRange,
      readOnly,
      selectedPage,
      setBusy,
      setDocument,
      setMessage,
      setPendingRange,
      setSelectionMode,
      setTextCandidateRange,
      setTextCandidates
    } = session;
    if (!pendingRange || selectedPage == null || readOnly || !document) return;
    const range = pendingRange;
    setPendingRange(null);
    setSelectionMode(false);
    if (kind === 'SHAPE') {
      addCreatedOverlay(kind, range);
      setMessage('図形・記号オーバーレイを追加しました。内容を編集して保存してください。');
      return;
    }
    if (busy) return;
    setBusy(true);
    setMessage(kind === 'TEXT' ? '選択範囲から文章候補を抽出しています…' : '選択範囲を画像assetに切り出しています…');
    try {
      if (kind === 'TEXT') {
        const candidates = await findAssemblyProcedureTextCandidates({
          id: document.id,
          accessPassword: passwordInput,
          pageIndex: selectedPage.pageIndex,
          bbox: range
        });
        if (candidates.length > 0) {
          setTextCandidates(candidates);
          setTextCandidateRange({ pageIndex: selectedPage.pageIndex, bbox: range });
          setMessage('文章候補を選択してください。');
        } else {
          addCreatedOverlay(kind, range);
          setMessage('文章候補が見つからないため、手入力の文章オーバーレイを追加しました。');
        }
      } else {
        const asset = await createAssemblyProcedureImageRegion({
          id: document.id,
          accessPassword: passwordInput,
          pageIndex: selectedPage.pageIndex,
          bbox: range
        });
        setDocument((current) => current ? {
          ...current,
          assets: { ...(current.assets ?? {}), [asset.assetId]: asset }
        } : current);
        addCreatedOverlay(kind, range, { assetId: asset.assetId });
        setMessage('選択範囲を画像assetとして追加しました。保存してください。');
      }
    } catch (error: unknown) {
      if (kind === 'TEXT') {
        addCreatedOverlay(kind, range);
        setMessage(`文章抽出に失敗したため、手入力の文章オーバーレイを追加しました。${readAssemblyApiErrorMessage(error, '')}`);
      } else {
        addCreatedOverlay(kind, range);
        setMessage(`画像切り出しに失敗しました。画像assetを指定して保存してください。${readAssemblyApiErrorMessage(error, '')}`);
      }
    } finally {
      setBusy(false);
    }
  }, [addCreatedOverlay, session]);

  const chooseTextCandidate = useCallback((candidate: AssemblyProcedureTextCandidateDto | null) => {
    const {
      readOnly,
      selectedElement,
      textCandidateRange,
      setMessage,
      setTextCandidateRange,
      setTextCandidates
    } = session;
    if (!textCandidateRange || readOnly) return;

    if (textCandidateRange.overlayId) {
      if (selectedElement?.id === textCandidateRange.overlayId && selectedElement.kind === 'TEXT') {
        if (candidate) {
          session.dispatch({
            type: 'update',
            element: { ...selectedElement, text: candidate.text }
          });
          setMessage('文章オーバーレイを更新しました。内容を編集して保存してください。');
        } else {
          setMessage('文章候補の選択をキャンセルしました。');
        }
      } else {
        setMessage('対象の文章オーバーレイが見つからないため、候補を適用しませんでした。');
      }
      setTextCandidates([]);
      setTextCandidateRange(null);
      return;
    }

    const bbox = candidate?.bounds ?? textCandidateRange.bbox;
    addCreatedOverlay('TEXT', bbox, { text: candidate?.text ?? 'ここに文章を入力' }, textCandidateRange.pageIndex);
    setTextCandidates([]);
    setTextCandidateRange(null);
    setMessage('文章オーバーレイを追加しました。内容を編集して保存してください。');
  }, [addCreatedOverlay, session]);

  const cancelTextCandidates = useCallback(() => {
    session.setTextCandidates([]);
    session.setTextCandidateRange(null);
    session.setMessage('文章候補の選択をキャンセルしました。');
  }, [session]);

  const refetchTextCandidates = useCallback(async () => {
    const {
      busy,
      document,
      passwordInput,
      readOnly,
      selectedElement,
      selectedPage,
      setBusy,
      setMessage,
      setTextCandidateRange,
      setTextCandidates
    } = session;
    if (
      busy ||
      !document ||
      readOnly ||
      !selectedPage ||
      !selectedElement ||
      selectedElement.kind !== 'TEXT'
    ) return;

    const { bbox, id: overlayId, pageIndex } = selectedElement;
    setTextCandidates([]);
    setTextCandidateRange(null);
    setBusy(true);
    setMessage('選択範囲から文章候補を再取得しています…');
    try {
      const candidates = await findAssemblyProcedureTextCandidates({
        id: document.id,
        accessPassword: passwordInput,
        pageIndex,
        bbox
      });
      if (candidates.length > 0) {
        setTextCandidates(candidates);
        setTextCandidateRange({ pageIndex, bbox, overlayId });
        setMessage('文章候補を選択してください。');
      } else {
        setMessage('文章候補が見つかりません。既存文章を保持しています。');
      }
    } catch (error: unknown) {
      setMessage(readAssemblyApiErrorMessage(error, '文章候補の再取得に失敗しました。'));
    } finally {
      setBusy(false);
    }
  }, [session]);

  const uploadImage = useCallback(async (file: File) => {
    const {
      busy,
      document,
      passwordInput,
      readOnly,
      selectedElement,
      setBusy,
      setDocument,
      setMessage,
      dispatch
    } = session;
    if (!document || !selectedElement || selectedElement.kind !== 'IMAGE' || readOnly || busy) return;
    setBusy(true);
    setMessage('画像assetを登録しています…');
    try {
      const asset = await uploadAssemblyProcedureOverlayImage({
        id: document.id,
        accessPassword: passwordInput,
        file
      });
      setDocument((current) => current ? {
        ...current,
        assets: { ...(current.assets ?? {}), [asset.assetId]: asset }
      } : current);
      dispatch({ type: 'update', element: { ...selectedElement, assetId: asset.assetId } });
      setMessage('画像assetを登録しました。保存してください。');
    } catch (error: unknown) {
      setMessage(readAssemblyApiErrorMessage(error, '画像assetの登録に失敗しました。'));
    } finally {
      setBusy(false);
    }
  }, [session]);

  return {
    createOverlay,
    chooseTextCandidate,
    cancelTextCandidates,
    refetchTextCandidates,
    uploadImage
  };
}
