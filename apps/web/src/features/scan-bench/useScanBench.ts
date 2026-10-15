import { ChecksumException, FormatException, NotFoundException } from '@zxing/library';
import { useCallback, useEffect, useRef, useState } from 'react';

import { BARCODE_READER_OPTIONS_KIOSK_DEFAULT } from '../barcode-scan/readerOptionPresets';
import { createBrowserMultiFormatReader } from '../barcode-scan/zxingVideoReader';

import { getBarcodeDetector } from './barcodeDetector';
import { NATIVE_FORMATS, supportsRequiredFormats, toNativeFormat, ZXING_FORMATS } from './helpers';
import { useBenchCamera } from './useBenchCamera';

import type { NativeBarcode, NativeBarcodeDetector } from './barcodeDetector';
import type { CameraQuality, ScanEngine, ScanRecord } from './helpers';

export function useScanBench() {
  const [engine, setEngine] = useState<ScanEngine>('zxing');
  const [quality, setQuality] = useState<CameraQuality>('standard');
  const [supported, setSupported] = useState<string[]>([]);
  const [checking, setChecking] = useState(true);
  const detector = useRef<NativeBarcodeDetector | null>(null);
  const nativePending = useRef<Promise<NativeBarcode[]> | null>(null);
  const cancelRef = useRef<() => void>(() => {});
  const [scanning, setScanning] = useState(false);
  const [records, setRecords] = useState<ScanRecord[]>([]);
  const [last, setLast] = useState<ScanRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancel = useCallback(() => { cancelRef.current(); setScanning(false); }, []);
  const camera = useBenchCamera(cancel, quality);

  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        const Constructor = getBarcodeDetector();
        const formats = Constructor ? await Constructor.getSupportedFormats() : [];
        if (disposed) return;
        setSupported(formats);
        if (Constructor && supportsRequiredFormats(formats)) {
          detector.current = new Constructor({ formats: [...NATIVE_FORMATS] });
        }
      } catch {
        detector.current = null;
      } finally {
        if (!disposed) setChecking(false);
      }
    })();
    return () => { disposed = true; detector.current = null; cancel(); };
  }, [cancel]);

  const selectEngine = (next: ScanEngine) => {
    cancel();
    setEngine(next);
    setError(null);
  };

  const read = () => {
    const t0 = performance.now();
    const video = camera.videoRef.current;
    if (!video || camera.status !== 'ready' || scanning || (engine === 'native' && !detector.current)) return;
    cancel();
    setScanning(true);
    setError(null);
    let active = true;
    let frame = 0;
    const reader = engine === 'zxing'
      ? createBrowserMultiFormatReader(ZXING_FORMATS, BARCODE_READER_OPTIONS_KIOSK_DEFAULT)
      : null;
    const cleanup = () => {
      active = false;
      window.clearTimeout(timeout);
      cancelAnimationFrame(frame);
      // Do not reset: the preview stream belongs to the camera hook, not ZXing.
      reader?.stopContinuousDecode();
    };
    const finish = (value: string | null, format: string | null) => {
      if (!active) return;
      const elapsedMs = performance.now() - t0;
      const timedOut = value === null || elapsedMs >= 15000;
      const record: ScanRecord = { engine, quality, elapsedMs: timedOut ? 15000 : elapsedMs, value: timedOut ? null : value, format: timedOut ? null : format };
      cleanup();
      setScanning(false);
      setRecords((previous) => [...previous, record]);
      setLast(record);
      if (!timedOut) {
        try { navigator.vibrate?.(80); } catch { /* Feedback must not affect results. */ }
      }
    };
    const fail = () => {
      if (!active) return;
      cleanup();
      setScanning(false);
      setError('読取エラー。もう一度お試しください');
    };
    const timeout = window.setTimeout(() => finish(null, null), 15000);
    cancelRef.current = cleanup;
    if (reader) {
      // Same continuous loop and retry timing as decodeFromStream, using the already-playing video.
      reader.decodeContinuously(video, (result, decodeError) => {
        if (result) finish(result.getText(), toNativeFormat(result.getBarcodeFormat()) ?? String(result.getBarcodeFormat()));
        else if (decodeError && !(decodeError instanceof NotFoundException || decodeError instanceof ChecksumException || decodeError instanceof FormatException)) fail();
      });
    } else {
      const native = detector.current!;
      const loop = async () => {
        try {
          // A cancelled measurement's detect cannot be aborted. Drain it before starting another.
          if (nativePending.current) await nativePending.current.catch(() => []);
          if (!active) return;
          const pending = native.detect(video);
          nativePending.current = pending;
          const results = await pending;
          if (nativePending.current === pending) nativePending.current = null;
          if (!active) return;
          if (results.length) finish(results[0].rawValue, results[0].format);
          else frame = requestAnimationFrame(() => { void loop(); });
        } catch { fail(); }
      };
      void loop();
    }
  };

  return {
    camera, engine, selectEngine, quality, selectQuality: setQuality, supported, checking,
    nativeAvailable: !checking && detector.current !== null,
    scanning, read, records, last, error,
    clear: () => { setRecords([]); setLast(null); },
  };
}
