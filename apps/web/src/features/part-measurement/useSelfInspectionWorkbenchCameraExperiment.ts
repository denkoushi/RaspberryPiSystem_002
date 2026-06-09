import { useCallback, useEffect, useRef, useState } from 'react';

import { getCameraStream, stopCameraStream } from '../../utils/camera';

const CAPTURE_INTERVAL_MS = 10_000;
const LOG_INTERVAL_MS = 30_000;

export type SelfInspectionWorkbenchCameraMetrics = {
  enabled: boolean;
  successCount: number;
  failureCount: number;
  skippedInFlightCount: number;
  lastGetUserMediaMs: number | null;
  averageGetUserMediaMs: number | null;
  lastCaptureMs: number | null;
  averageCaptureMs: number | null;
  lastBlobSize: number | null;
  lastError: string | null;
};

async function captureSingleFrameBlob(stream: MediaStream): Promise<Blob> {
  const video = document.createElement('video');
  video.autoplay = true;
  video.playsInline = true;
  video.muted = true;
  video.style.position = 'fixed';
  video.style.top = '-9999px';
  video.style.left = '-9999px';
  video.style.width = '1px';
  video.style.height = '1px';
  video.style.opacity = '0';
  document.body.appendChild(video);

  try {
    video.srcObject = stream;
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('video metadata timeout')), 5000);
      video.onloadedmetadata = () => {
        window.clearTimeout(timeout);
        resolve();
      };
      video.onerror = () => {
        window.clearTimeout(timeout);
        reject(new Error('video load failed'));
      };
    });
    await video.play();
    await new Promise((resolve) => window.setTimeout(resolve, 80));

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('canvas context unavailable');
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error('blob conversion failed'));
        },
        'image/jpeg',
        0.8
      );
    });
  } finally {
    video.pause();
    video.srcObject = null;
    video.remove();
  }
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function useSelfInspectionWorkbenchCameraExperiment(options?: {
  onLog?: (metrics: SelfInspectionWorkbenchCameraMetrics) => void;
}) {
  const [enabled, setEnabled] = useState(false);
  const [metrics, setMetrics] = useState<SelfInspectionWorkbenchCameraMetrics>({
    enabled: false,
    successCount: 0,
    failureCount: 0,
    skippedInFlightCount: 0,
    lastGetUserMediaMs: null,
    averageGetUserMediaMs: null,
    lastCaptureMs: null,
    averageCaptureMs: null,
    lastBlobSize: null,
    lastError: null
  });

  const enabledRef = useRef(false);
  const inFlightRef = useRef(false);
  const runIdRef = useRef(0);
  const getUserMediaSamplesRef = useRef<number[]>([]);
  const captureSamplesRef = useRef<number[]>([]);
  const lastLogAtRef = useRef(0);
  const onLogRef = useRef(options?.onLog);
  onLogRef.current = options?.onLog;

  const logMetricsIfDue = useCallback((next: SelfInspectionWorkbenchCameraMetrics) => {
    const now = Date.now();
    if (onLogRef.current && now - lastLogAtRef.current >= LOG_INTERVAL_MS) {
      lastLogAtRef.current = now;
      onLogRef.current(next);
    }
  }, []);

  const runCaptureCycle = useCallback(async () => {
    if (!enabledRef.current || inFlightRef.current || document.visibilityState === 'hidden') {
      if (enabledRef.current && inFlightRef.current) {
        setMetrics((prev) => ({
          ...prev,
          skippedInFlightCount: prev.skippedInFlightCount + 1
        }));
      }
      return;
    }

    const runId = ++runIdRef.current;
    inFlightRef.current = true;
    let stream: MediaStream | null = null;

    try {
      const mediaStartedAt = performance.now();
      stream = await getCameraStream();
      const getUserMediaMs = performance.now() - mediaStartedAt;
      if (!enabledRef.current || runId !== runIdRef.current) {
        return;
      }

      getUserMediaSamplesRef.current.push(getUserMediaMs);
      const captureStartedAt = performance.now();
      const blob = await captureSingleFrameBlob(stream);
      const captureMs = performance.now() - captureStartedAt;
      captureSamplesRef.current.push(captureMs);

      if (!enabledRef.current || runId !== runIdRef.current) {
        return;
      }

      setMetrics((prev) => {
        const next: SelfInspectionWorkbenchCameraMetrics = {
          ...prev,
          enabled: true,
          successCount: prev.successCount + 1,
          lastGetUserMediaMs: getUserMediaMs,
          averageGetUserMediaMs: average(getUserMediaSamplesRef.current),
          lastCaptureMs: captureMs,
          averageCaptureMs: average(captureSamplesRef.current),
          lastBlobSize: blob.size,
          lastError: null
        };
        logMetricsIfDue(next);
        return next;
      });
    } catch (error) {
      if (!enabledRef.current || runId !== runIdRef.current) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      setMetrics((prev) => {
        const next: SelfInspectionWorkbenchCameraMetrics = {
          ...prev,
          enabled: true,
          failureCount: prev.failureCount + 1,
          lastError: message
        };
        logMetricsIfDue(next);
        return next;
      });
    } finally {
      stopCameraStream(stream);
      inFlightRef.current = false;
    }
  }, [logMetricsIfDue]);

  const toggle = useCallback(() => {
    const next = !enabledRef.current;
    enabledRef.current = next;
    if (!next) {
      runIdRef.current += 1;
    }
    setEnabled(next);
    setMetrics((current) => ({ ...current, enabled: next }));
  }, []);

  useEffect(() => {
    enabledRef.current = enabled;
    if (!enabled) {
      runIdRef.current += 1;
      return;
    }

    void runCaptureCycle();
    const intervalId = window.setInterval(() => {
      void runCaptureCycle();
    }, CAPTURE_INTERVAL_MS);

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && enabledRef.current) {
        void runCaptureCycle();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      runIdRef.current += 1;
    };
  }, [enabled, runCaptureCycle]);

  useEffect(
    () => () => {
      enabledRef.current = false;
      runIdRef.current += 1;
    },
    []
  );

  return {
    workbenchCameraEnabled: enabled,
    toggleWorkbenchCamera: toggle,
    workbenchCameraMetrics: metrics
  };
}
