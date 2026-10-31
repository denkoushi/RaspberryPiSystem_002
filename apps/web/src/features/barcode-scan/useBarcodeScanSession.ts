import { useCallback, useEffect, useRef, useState } from 'react';

import { getCameraStream, stopCameraStream } from '../../utils/camera';

import { createNativeBarcodeDetector } from './barcodeDetector';
import { reduceBarcodeStability } from './barcodeReadStability';
import { captureScanFrame, readScanCamera, resultPointsBox, type ScanFrameCapture, type ScanCropBox } from './scanFrameCapture';
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
  engine?: 'zxing' | 'auto-native';
  nativeCameraResolution?: { width: number; height: number };
  stabilityConfig?: BarcodeStabilityConfig;
  /** 未検出のままこの時間で打ち切り */
  idleTimeoutMs: number;
  onFrameCaptured?: (capture: ScanFrameCapture) => void;
  onSuccess: (text: string) => void;
  /** キャンセル・タイムアウト・またはカメラエラー画面を閉じたとき */
  onAbort: () => void;
};

/**
 * 既定は ZXing。opt-in 時は対応形式を確認してネイティブ読取を優先する。
 */
export function useBarcodeScanSession({
  active,
  videoRef,
  formats,
  readerOptions,
  engine = 'zxing',
  nativeCameraResolution,
  stabilityConfig,
  idleTimeoutMs,
  onSuccess,
  onAbort,
  onFrameCaptured,
}: UseBarcodeScanSessionOptions): {
  cameraError: string | null;
  clearCameraError: () => void;
  requestCancel: () => void;
} {
  const [cameraError, setCameraError] = useState<string | null>(null);
  const onSuccessRef = useRef(onSuccess);
  const onAbortRef = useRef(onAbort);
  const onFrameCapturedRef = useRef(onFrameCaptured);
  onFrameCapturedRef.current = onFrameCaptured;
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const stopNativeRef = useRef<(() => void) | null>(null);
  const disposedRef = useRef(true);
  const timeoutIdRef = useRef<ReturnType<typeof window.setTimeout> | undefined>(undefined);
  const acquiredStreamRef = useRef<MediaStream | null>(null);

  onSuccessRef.current = onSuccess;
  onAbortRef.current = onAbort;

  const clearCameraError = useCallback(() => setCameraError(null), []);

  const teardownReader = useCallback(() => {
    stopNativeRef.current?.();
    stopNativeRef.current = null;
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

    let cancelled = false;
    const isDisposed = () => cancelled || disposedRef.current;

    const captureEnabled = Boolean(onFrameCapturedRef.current);
    let startedAt = 0;
    let retryCount = 0;
    let camera: Record<string, unknown> = {};
    let captureEngine: 'native' | 'zxing' = 'zxing';
    const capture = (outcome: 'decoded' | 'timeout', decodedValue: string | null, cropBox: ScanCropBox | null) => {
      if (!captureEnabled) return;
      try {
        const frame = captureScanFrame(video, {
          outcome, decodedValue, cropBox, decodeMs: Math.round(performance.now() - startedAt), retryCount,
          engine: captureEngine, camera, torchOn: typeof camera.torch === 'boolean' ? camera.torch : undefined,
          zoom: typeof camera.zoom === 'number' ? camera.zoom : undefined
        });
        if (frame) onFrameCapturedRef.current?.(frame);
      } catch { /* Frame collection must never interrupt a scan. */ }
    };
    let stabilityState: BarcodeStabilityState | null = null;

    const finishSuccess = (text: string, cropBox: ScanCropBox | null) => {
      if (isDisposed()) {
        return;
      }
      capture('decoded', text, cropBox);
      disposedRef.current = true;
      stopAcquiredStream();
      teardownReader();
      onSuccessRef.current(text);
    };

    const finishAbort = () => {
      if (isDisposed()) {
        return;
      }
      capture('timeout', null, null);
      disposedRef.current = true;
      stopAcquiredStream();
      teardownReader();
      onAbortRef.current();
    };

    const onDecoded = (raw: string | undefined, cropBox: ScanCropBox | null = null) => {
      if (isDisposed()) return;
      const text = raw?.trim() ?? '';
      if (!text) return;
      if (stabilityConfig == null) {
        finishSuccess(text, cropBox);
        return;
      }
      const { next, shouldConfirm } = reduceBarcodeStability(stabilityState, text, Date.now(), stabilityConfig);
      stabilityState = next;
      if (shouldConfirm && next != null) finishSuccess(next.value, cropBox);
    };

    void (async () => {
      try {
        const detector = engine === 'auto-native' ? await createNativeBarcodeDetector(formats) : null;
        if (isDisposed()) return;
        const stream = detector
          ? await navigator.mediaDevices.getUserMedia({
              audio: false,
              video: {
                facingMode: 'environment',
                width: { ideal: nativeCameraResolution?.width ?? 1280 },
                height: { ideal: nativeCameraResolution?.height ?? 720 },
              },
            })
          : await getCameraStream();
        if (isDisposed()) {
          stopCameraStream(stream);
          return;
        }
        acquiredStreamRef.current = stream;
        startedAt = captureEnabled ? performance.now() : 0;
        if (captureEnabled) {
          captureEngine = detector ? 'native' : 'zxing';
          try { camera = readScanCamera(stream); } catch { /* Metadata is best effort. */ }
        }
        timeoutIdRef.current = window.setTimeout(finishAbort, idleTimeoutMs);

        if (detector) {
          let frameId: number | undefined;
          stopNativeRef.current = () => {
            if (frameId !== undefined) window.cancelAnimationFrame(frameId);
            video.srcObject = null;
          };
          video.srcObject = stream;
          await video.play();
          const decodeFrame = async () => {
            if (isDisposed()) return;
            if (video.readyState >= 2) {
              try {
                const results = await detector.detect(video);
                if (captureEnabled && !isDisposed() && results.length === 0) retryCount += 1;
                onDecoded(results[0]?.rawValue, captureEnabled ? results[0]?.boundingBox ?? null : null);
              } catch {
                // A frame may be temporarily unavailable; try the next frame.
              }
            }
            if (!isDisposed()) frameId = window.requestAnimationFrame(() => { void decodeFrame(); });
          };
          if (!isDisposed()) void decodeFrame();
        } else {
          const reader = createBrowserMultiFormatReader(formats, readerOptions);
          readerRef.current = reader;
          await reader.decodeFromStream(stream, video, (result, error) => {
            if (isDisposed()) return;
            if (captureEnabled && error) retryCount += 1;
            onDecoded(result?.getText(), captureEnabled && result ? resultPointsBox(result.getResultPoints() ?? []) : null);
          });
        }
      } catch {
        if (isDisposed()) {
          return;
        }
        disposedRef.current = true;
        stopAcquiredStream();
        teardownReader();
        setCameraError('カメラを使えません');
      }
    })();

    return () => {
      cancelled = true;
      disposedRef.current = true;
      stopAcquiredStream();
      teardownReader();
    };
  }, [
    active,
    engine,
    nativeCameraResolution,
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
