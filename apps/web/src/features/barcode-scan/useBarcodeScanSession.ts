import { useCallback, useEffect, useRef, useState } from 'react';

import { getCameraStream, stopCameraStream } from '../../utils/camera';

import { reduceBarcodeStability } from './barcodeReadStability';
import { createBrowserMultiFormatReader } from './zxingVideoReader';

import type { BarcodeStabilityConfig, BarcodeStabilityState } from './barcodeReadStability';
import type { BarcodeReaderTimingOptions } from './zxingVideoReader';
import type { BarcodeFormat, BrowserMultiFormatReader } from '@zxing/library';


export type UseBarcodeScanSessionOptions = {
  /** false ならカメラ・デコードを行わない */
  active: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  formats: BarcodeFormat[];
  readerOptions?: BarcodeReaderTimingOptions;
  stabilityConfig?: BarcodeStabilityConfig;
  /** 未検出のままこの時間で打ち切り */
  idleTimeoutMs: number;
  onSuccess: (text: string) => void;
  /** キャンセル・タイムアウト・またはカメラエラー画面を閉じたとき */
  onAbort: () => void;
};

/**
 * getUserMedia で取得したストリームを ZXing で連続デコードする。
 */
export function useBarcodeScanSession({
  active,
  videoRef,
  formats,
  readerOptions,
  stabilityConfig,
  idleTimeoutMs,
  onSuccess,
  onAbort,
}: UseBarcodeScanSessionOptions): {
  cameraError: string | null;
  clearCameraError: () => void;
  requestCancel: () => void;
} {
  const [cameraError, setCameraError] = useState<string | null>(null);
  const onSuccessRef = useRef(onSuccess);
  const onAbortRef = useRef(onAbort);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const disposedRef = useRef(true);
  const timeoutIdRef = useRef<ReturnType<typeof window.setTimeout> | undefined>();
  const acquiredStreamRef = useRef<MediaStream | null>(null);

  onSuccessRef.current = onSuccess;
  onAbortRef.current = onAbort;

  const clearCameraError = useCallback(() => setCameraError(null), []);

  const teardownReader = useCallback(() => {
    if (timeoutIdRef.current !== undefined) {
      window.clearTimeout(timeoutIdRef.current);
      timeoutIdRef.current = undefined;
    }
    const reader = readerRef.current;
    readerRef.current = null;
    if (!reader) {
      return;
    }
    try {
      reader.stopContinuousDecode();
    } catch {
      /* noop */
    }
    try {
      reader.reset();
    } catch {
      /* noop */
    }
  }, []);

  const stopAcquiredStream = useCallback(() => {
    const s = acquiredStreamRef.current;
    acquiredStreamRef.current = null;
    if (s) {
      stopCameraStream(s);
    }
  }, []);

  const requestCancel = useCallback(() => {
    if (disposedRef.current) {
      return;
    }
    disposedRef.current = true;
    stopAcquiredStream();
    teardownReader();
    onAbortRef.current();
  }, [stopAcquiredStream, teardownReader]);

  useEffect(() => {
    if (!active) {
      disposedRef.current = true;
      stopAcquiredStream();
      teardownReader();
      setCameraError(null);
      return;
    }

    const video = videoRef.current;
    if (!video) {
      return;
    }

    disposedRef.current = false;
    setCameraError(null);

    const reader = createBrowserMultiFormatReader(formats, readerOptions);
    readerRef.current = reader;

    let stabilityState: BarcodeStabilityState | null = null;

    const finishSuccess = (text: string) => {
      if (disposedRef.current) {
        return;
      }
      disposedRef.current = true;
      stopAcquiredStream();
      teardownReader();
      onSuccessRef.current(text);
    };

    const finishAbort = () => {
      if (disposedRef.current) {
        return;
      }
      disposedRef.current = true;
      stopAcquiredStream();
      teardownReader();
      onAbortRef.current();
    };

    void (async () => {
      try {
        const stream = await getCameraStream();
        if (disposedRef.current) {
          stopCameraStream(stream);
          return;
        }
        acquiredStreamRef.current = stream;

        timeoutIdRef.current = window.setTimeout(() => {
          finishAbort();
        }, idleTimeoutMs);

        await reader.decodeFromStream(stream, video, (result) => {
          if (disposedRef.current) {
            return;
          }
          const raw = result?.getText();
          const text = raw?.trim() ?? '';
          if (text.length === 0) {
            return;
          }
          if (stabilityConfig == null) {
            finishSuccess(text);
            return;
          }
          const { next, shouldConfirm } = reduceBarcodeStability(
            stabilityState,
            text,
            Date.now(),
            stabilityConfig
          );
          stabilityState = next;
          if (shouldConfirm && next != null) {
            finishSuccess(next.value);
          }
        });
      } catch {
        if (disposedRef.current) {
          return;
        }
        disposedRef.current = true;
        stopAcquiredStream();
        teardownReader();
        setCameraError('カメラを使えません');
      }
    })();

    return () => {
      disposedRef.current = true;
      stopAcquiredStream();
      teardownReader();
    };
  }, [
    active,
    formats,
    idleTimeoutMs,
    readerOptions,
    stabilityConfig,
    stopAcquiredStream,
    teardownReader,
    videoRef,
  ]);

  return { cameraError, clearCameraError, requestCancel };
}
