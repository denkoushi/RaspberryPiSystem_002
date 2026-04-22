import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { Button } from '../../components/ui/Button';

import { useBarcodeScanSession } from './useBarcodeScanSession';

import type { BarcodeStabilityConfig } from './barcodeReadStability';
import type { BarcodeReaderTimingOptions } from './zxingVideoReader';
import type { BarcodeFormat } from '@zxing/library';

export type BarcodeScanModalProps = {
  open: boolean;
  formats: BarcodeFormat[];
  readerOptions?: BarcodeReaderTimingOptions;
  stabilityConfig?: BarcodeStabilityConfig;
  /** 未検出打ち切り ms（既定 30s） */
  idleTimeoutMs?: number;
  onSuccess: (text: string) => void;
  /** 取消・タイムアウト・エラー閉じる（検索欄クリアは親） */
  onAbort: () => void;
};

/**
 * カメラプレビューでバーコードを連続読取するモーダル（キオスク想定・Pi 負荷配慮）。
 */
export function BarcodeScanModal({
  open,
  formats,
  readerOptions,
  stabilityConfig,
  idleTimeoutMs = 30_000,
  onSuccess,
  onAbort,
}: BarcodeScanModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [videoReady, setVideoReady] = useState(false);

  const assignVideoRef = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
    setVideoReady(!!el);
  }, []);

  useEffect(() => {
    if (!open) {
      setVideoReady(false);
    }
  }, [open]);

  const { cameraError, clearCameraError, requestCancel } = useBarcodeScanSession({
    active: open && videoReady,
    videoRef,
    formats,
    readerOptions,
    stabilityConfig,
    idleTimeoutMs,
    onSuccess,
    onAbort,
  });

  const handleDismissError = () => {
    clearCameraError();
    onAbort();
  };

  if (!open || typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="barcode-scan-modal-title"
    >
      <div className="flex w-full max-w-lg flex-col gap-3 rounded-lg border border-white/15 bg-slate-900 p-4 shadow-xl">
        <h2 id="barcode-scan-modal-title" className="text-lg font-semibold text-white">
          バーコードをスキャン
        </h2>

        {cameraError ? (
          <p className="text-sm text-red-300" role="alert">
            {cameraError}
          </p>
        ) : (
          <p className="text-sm text-white/70">コードをカメラに向けてください</p>
        )}

        <div className="relative aspect-video w-full overflow-hidden rounded-md bg-black">
          <video
            ref={assignVideoRef}
            className="h-full w-full object-cover"
            muted
            playsInline
            autoPlay
          />
        </div>

        <div className="flex justify-end gap-2">
          {cameraError ? (
            <Button type="button" variant="secondary" onClick={handleDismissError}>
              閉じる
            </Button>
          ) : (
            <Button type="button" variant="ghostOnDark" onClick={requestCancel}>
              キャンセル
            </Button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
