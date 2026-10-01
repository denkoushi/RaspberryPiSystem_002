import { useCallback, useState } from 'react';

import { previewSignageWebCapture } from '../../../api/client';
import { getApiErrorMessage } from '../../../api/errors';
import { useSignageWebCaptureMutations } from '../../../api/hooks';

import type { SignageWebCapture, SignageWebCaptureInput, SignageWebCapturePreview } from '../../../api/client';

export const NEW_WEB_CAPTURE_DRAFT: SignageWebCaptureInput = {
  name: '',
  path: '/admin/',
  viewportWidth: 1920,
  viewportHeight: 1080,
  waitMode: 'network_idle',
  waitSeconds: 3,
  hideSelectors: [],
  clipSelector: null,
  refreshIntervalSeconds: 300,
  enabled: true,
};

function draftOf(capture: SignageWebCapture): SignageWebCaptureInput {
  return {
    name: capture.name,
    path: capture.path,
    viewportWidth: capture.viewportWidth,
    viewportHeight: capture.viewportHeight,
    waitMode: capture.waitMode,
    waitSeconds: capture.waitSeconds,
    hideSelectors: capture.hideSelectors,
    clipSelector: capture.clipSelector,
    refreshIntervalSeconds: capture.refreshIntervalSeconds,
    enabled: capture.enabled,
  };
}

/** ページ撮影コンテンツの追加・編集の状態（右パネルと中央プレビューで共有する） */
export function useWebCaptureEditor() {
  const { create, update, remove } = useSignageWebCaptureMutations();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<SignageWebCaptureInput>(NEW_WEB_CAPTURE_DRAFT);
  const [preview, setPreview] = useState<SignageWebCapturePreview | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = useCallback((capture: SignageWebCapture | null) => {
    setEditingId(capture?.id ?? null);
    setDraft(capture ? draftOf(capture) : NEW_WEB_CAPTURE_DRAFT);
    setPreview(null);
    setError(null);
  }, []);

  const runPreview = useCallback(async (settings: SignageWebCaptureInput) => {
    setIsPreviewing(true);
    setError(null);
    try {
      const result = await previewSignageWebCapture({
        path: settings.path,
        viewportWidth: settings.viewportWidth,
        viewportHeight: settings.viewportHeight,
        waitMode: settings.waitMode,
        waitSeconds: settings.waitSeconds,
        hideSelectors: settings.hideSelectors,
        clipSelector: settings.clipSelector,
      });
      setPreview(result);
    } catch (err) {
      setError(getApiErrorMessage(err, '撮影できませんでした'));
    } finally {
      setIsPreviewing(false);
    }
  }, []);

  /** 「隠す部分」の追加・解除。プレビューがあれば同じ設定で撮り直す。 */
  const toggleHideSelector = useCallback(
    (selector: string) => {
      const next = draft.hideSelectors.includes(selector)
        ? draft.hideSelectors.filter((value) => value !== selector)
        : [...draft.hideSelectors, selector];
      const nextDraft = { ...draft, hideSelectors: next };
      setDraft(nextDraft);
      if (preview) void runPreview(nextDraft);
    },
    [draft, preview, runPreview],
  );

  const save = useCallback(async (): Promise<SignageWebCapture | null> => {
    setError(null);
    if (draft.name.trim() === '') {
      setError('名前を入力してください');
      return null;
    }
    try {
      const payload = { ...draft, name: draft.name.trim(), path: draft.path.trim() };
      return editingId
        ? await update.mutateAsync({ id: editingId, payload })
        : await create.mutateAsync(payload);
    } catch (err) {
      setError(getApiErrorMessage(err, '保存できませんでした'));
      return null;
    }
  }, [create, draft, editingId, update]);

  const removeCurrent = useCallback(async (): Promise<boolean> => {
    if (!editingId) return false;
    setError(null);
    try {
      await remove.mutateAsync(editingId);
      return true;
    } catch (err) {
      setError(getApiErrorMessage(err, '削除できませんでした'));
      return false;
    }
  }, [editingId, remove]);

  return {
    editingId,
    draft,
    setDraft,
    preview,
    isPreviewing,
    isSaving: create.isPending || update.isPending,
    error,
    start,
    runPreview: () => runPreview(draft),
    toggleHideSelector,
    save,
    removeCurrent,
  };
}

export type WebCaptureEditor = ReturnType<typeof useWebCaptureEditor>;
