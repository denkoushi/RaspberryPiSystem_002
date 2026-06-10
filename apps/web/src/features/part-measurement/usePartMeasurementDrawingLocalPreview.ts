import { useCallback, useEffect, useRef, useState } from 'react';

import { previewPartMeasurementDrawing } from '../../api/client';

import {
  isPartMeasurementDrawingPreviewConversionFile,
  partMeasurementDrawingPreviewJpegFile,
  revokePartMeasurementDrawingPreviewUrl
} from './partMeasurementDrawingLocalPreview';

export type UsePartMeasurementDrawingLocalPreviewResult = {
  /** Canvas 表示用の画像 Blob URL（PDF/TIFF 変換後 JPEG または画像そのまま） */
  localPreviewUrl: string | null;
  /** 保存 API に渡す File（PDF/TIFF は変換済み JPEG） */
  saveFile: File | null;
  /** 変換対象ファイル選択中（PDF/TIFF 変換待ち含む） */
  pendingPreviewFile: File | null;
  /** PDF/TIFF プレビュー変換中 */
  previewResolving: boolean;
  /** プレビュー変換エラー（編集時は既存図面表示を維持） */
  previewError: string | null;
  /** ローカルプレビュー URL が確定している（サーバー fetch 抑止用） */
  hasLocalRenderablePreview: boolean;
  /** ファイル選択中（PDF/TIFF 変換待ち含む） */
  hasPendingLocalSelection: boolean;
  selectFile: (file: File | null) => void;
  reset: () => void;
};

function extractPreviewErrorMessage(error: unknown): string {
  const err = error as { response?: { data?: { message?: string } } };
  return err.response?.data?.message ?? '図面のプレビュー変換に失敗しました';
}

export function usePartMeasurementDrawingLocalPreview(
  clientKey?: string
): UsePartMeasurementDrawingLocalPreviewResult {
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);
  const [saveFile, setSaveFile] = useState<File | null>(null);
  const [pendingPreviewFile, setPendingPreviewFile] = useState<File | null>(null);
  const [previewResolving, setPreviewResolving] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [hasPendingLocalSelection, setHasPendingLocalSelection] = useState(false);

  const requestSeqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  const replaceLocalPreviewUrl = useCallback((nextUrl: string | null) => {
    revokePartMeasurementDrawingPreviewUrl(previewUrlRef.current);
    previewUrlRef.current = nextUrl;
    setLocalPreviewUrl(nextUrl);
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    requestSeqRef.current += 1;
    replaceLocalPreviewUrl(null);
    setSaveFile(null);
    setPendingPreviewFile(null);
    setPreviewResolving(false);
    setPreviewError(null);
    setHasPendingLocalSelection(false);
  }, [replaceLocalPreviewUrl]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      revokePartMeasurementDrawingPreviewUrl(previewUrlRef.current);
      previewUrlRef.current = null;
    };
  }, []);

  const selectFile = useCallback(
    (file: File | null) => {
      abortRef.current?.abort();
      abortRef.current = null;
      const requestId = ++requestSeqRef.current;

      replaceLocalPreviewUrl(null);
      setSaveFile(null);
      setPreviewError(null);
      setPendingPreviewFile(null);

      if (!file) {
        setPreviewResolving(false);
        setHasPendingLocalSelection(false);
        return;
      }

      setHasPendingLocalSelection(true);

      if (!isPartMeasurementDrawingPreviewConversionFile(file)) {
        const objectUrl = URL.createObjectURL(file);
        replaceLocalPreviewUrl(objectUrl);
        setSaveFile(file);
        setPreviewResolving(false);
        return;
      }

      setPendingPreviewFile(file);
      setPreviewResolving(true);
      const controller = new AbortController();
      abortRef.current = controller;

      void (async () => {
        try {
          const jpegBlob = await previewPartMeasurementDrawing(file, clientKey, controller.signal);
          if (requestId !== requestSeqRef.current || controller.signal.aborted) return;

          const jpegFile = partMeasurementDrawingPreviewJpegFile(jpegBlob, file.name);
          const objectUrl = URL.createObjectURL(jpegBlob);
          if (requestId !== requestSeqRef.current || controller.signal.aborted) {
            revokePartMeasurementDrawingPreviewUrl(objectUrl);
            return;
          }
          replaceLocalPreviewUrl(objectUrl);
          setSaveFile(jpegFile);
          setPreviewError(null);
        } catch (error) {
          if (controller.signal.aborted || requestId !== requestSeqRef.current) return;
          setPreviewError(extractPreviewErrorMessage(error));
          setHasPendingLocalSelection(false);
          setPendingPreviewFile(null);
        } finally {
          if (requestId === requestSeqRef.current) {
            setPreviewResolving(false);
            abortRef.current = null;
          }
        }
      })();
    },
    [clientKey, replaceLocalPreviewUrl]
  );

  return {
    localPreviewUrl,
    saveFile,
    pendingPreviewFile,
    previewResolving,
    previewError,
    hasLocalRenderablePreview: Boolean(localPreviewUrl),
    hasPendingLocalSelection,
    selectFile,
    reset
  };
}
