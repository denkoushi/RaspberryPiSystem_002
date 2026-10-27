import { useCallback, useEffect, useRef, useState } from 'react';

import { Dialog } from '../../../components/ui/Dialog';
import { stopCameraStream } from '../../../utils/camera';
import { haizenPhoneStyle, hp } from '../ui/haizenPhoneTokens';

import { encodeShelfPhoto } from './resizeShelfPhoto';

import type { ShelfPhotoData } from './resizeShelfPhoto';

export function ShelfPhotoCamera({ onCapture, onClose, onSelectFile }: {
  onCapture: (photo: ShelfPhotoData) => void;
  onClose: () => void;
  onSelectFile: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stop = useCallback(() => {
    stopCameraStream(streamRef.current);
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    const video = videoRef.current;
    void (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia || !video) throw new Error('camera unavailable');
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 960 } }
        });
        if (cancelled) { stopCameraStream(stream); return; }
        streamRef.current = stream;
        video.srcObject = stream;
        await video.play();
        if (!cancelled) setReady(true);
      } catch {
        if (cancelled) return;
        stop();
        setError('カメラを使えません');
      }
    })();
    return () => { cancelled = true; stop(); };
  }, [stop]);

  const close = () => { stop(); onClose(); };
  const capture = () => {
    const video = videoRef.current;
    if (!ready || !video || !streamRef.current) return;
    try {
      const photo = encodeShelfPhoto(video, video.videoWidth, video.videoHeight);
      stop();
      onCapture(photo);
    } catch {
      stop();
      setReady(false);
      setError('写真を撮れませんでした');
    }
  };

  return <Dialog isOpen onClose={close} ariaLabel="写真を撮る" overlayZIndex={80}
    className="!fixed !inset-0 !m-0 !flex !h-dvh !max-h-none !w-full !max-w-none !flex-col !rounded-none !border-0 !p-0">
    <div style={haizenPhoneStyle} className={`${hp.surface} flex min-h-0 flex-1 flex-col`}>
      <header className="flex shrink-0 justify-end p-3.5"><button type="button" className={hp.mini} onClick={close}>閉じる</button></header>
      <video ref={videoRef} autoPlay muted playsInline className="min-h-0 w-full flex-1 object-contain" />
      {error && <div className="flex shrink-0 flex-col items-center gap-3 p-3.5">
        <p role="alert" className="text-sm text-[var(--hp-ng)]">{error}</p>
        <button type="button" className={hp.mini} onClick={() => { stop(); onSelectFile(); onClose(); }}>写真を選ぶ</button>
      </div>}
      {!error && <footer className="flex shrink-0 justify-center px-3.5 pt-4 pb-[calc(24px+env(safe-area-inset-bottom,0px))]">
        <button type="button" aria-label="撮る" disabled={!ready} onClick={capture}
          className="h-20 w-20 rounded-full border-4 border-[var(--hp-ink2)] bg-[var(--hp-ink)] ring-4 ring-[var(--hp-panel)] disabled:opacity-40" />
      </footer>}
    </div>
  </Dialog>;
}
