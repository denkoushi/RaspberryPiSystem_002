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
  const cancelRef = useRef<() => void>(() => {});
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
    const media = window.matchMedia?.('(orientation: portrait)');
    const isPortrait = () => media?.matches ?? window.innerHeight > window.innerWidth;
    let desiredPortrait = isPortrait();
    let appliedPortrait: boolean | null = null;
    let updating = false;
    const cancel = () => { cancelled = true; stop(); };
    cancelRef.current = cancel;

    const update = async () => {
      if (cancelled || updating || appliedPortrait === desiredPortrait) return;
      updating = true;
      setReady(false);
      try {
        if (!navigator.mediaDevices?.getUserMedia || !video) throw new Error('camera unavailable');
        while (!cancelled && appliedPortrait !== desiredPortrait) {
          const portrait = desiredPortrait;
          const constraints = {
            width: { ideal: portrait ? 960 : 1280 },
            height: { ideal: portrait ? 1280 : 960 },
            aspectRatio: { ideal: portrait ? 3 / 4 : 4 / 3 }
          };
          if (streamRef.current) {
            try {
              await streamRef.current.getVideoTracks()[0].applyConstraints(constraints);
            } catch {
              if (cancelled) return;
              stop();
            }
          }
          if (cancelled) return;
          if (!streamRef.current) {
            const stream = await navigator.mediaDevices.getUserMedia({
              audio: false,
              video: { facingMode: 'environment', ...constraints }
            });
            if (cancelled) { stopCameraStream(stream); return; }
            streamRef.current = stream;
            video.srcObject = stream;
            await video.play();
          }
          appliedPortrait = portrait;
        }
        if (!cancelled) setReady(true);
      } catch {
        if (cancelled) return;
        cancel();
        setError('カメラを使えません');
      } finally {
        updating = false;
      }
    };
    const onOrientationChange = () => {
      desiredPortrait = isPortrait();
      void update();
    };
    media?.addEventListener?.('change', onOrientationChange);
    const screenOrientation = window.screen.orientation;
    screenOrientation?.addEventListener?.('change', onOrientationChange);
    window.addEventListener('resize', onOrientationChange);
    void update();
    return () => {
      media?.removeEventListener?.('change', onOrientationChange);
      screenOrientation?.removeEventListener?.('change', onOrientationChange);
      window.removeEventListener('resize', onOrientationChange);
      cancel();
    };
  }, [stop]);

  const close = () => { cancelRef.current(); onClose(); };
  const capture = () => {
    const video = videoRef.current;
    if (!ready || !video || !streamRef.current) return;
    try {
      const photo = encodeShelfPhoto(video, video.videoWidth, video.videoHeight);
      cancelRef.current();
      onCapture(photo);
    } catch {
      cancelRef.current();
      setReady(false);
      setError('写真を撮れませんでした');
    }
  };

  return <Dialog isOpen onClose={close} ariaLabel="写真を撮る" overlayZIndex={80}
    className="!fixed !inset-0 !m-0 !flex !h-dvh !max-h-none !w-full !max-w-none !flex-col !rounded-none !border-0 !p-0">
    <div style={haizenPhoneStyle} className={`${hp.surface} flex min-h-0 flex-1 flex-col pt-[env(safe-area-inset-top,0px)] pl-[env(safe-area-inset-left,0px)] pr-[env(safe-area-inset-right,0px)] landscape:grid landscape:grid-cols-[minmax(0,1fr)_auto] landscape:grid-rows-[auto_minmax(0,1fr)] landscape:pb-[env(safe-area-inset-bottom,0px)]`}>
      <header className="flex shrink-0 justify-end p-3.5 landscape:col-start-2 landscape:row-start-1 landscape:justify-center"><button type="button" className={hp.mini} onClick={close}>閉じる</button></header>
      <video ref={videoRef} autoPlay muted playsInline className="min-h-0 w-full flex-1 object-contain landscape:col-start-1 landscape:row-span-2 landscape:row-start-1 landscape:h-full landscape:min-w-0" />
      {error && <div className="flex shrink-0 flex-col items-center gap-3 p-3.5 landscape:col-start-2 landscape:row-start-2 landscape:max-w-40 landscape:overflow-y-auto">
        <p role="alert" className="text-sm text-[var(--hp-ng)]">{error}</p>
        <button type="button" className={hp.mini} onClick={() => { cancelRef.current(); onSelectFile(); onClose(); }}>写真を選ぶ</button>
      </div>}
      {!error && <footer className="flex shrink-0 justify-center px-3.5 pt-4 pb-[calc(24px+env(safe-area-inset-bottom,0px))] landscape:col-start-2 landscape:row-start-2 landscape:items-center landscape:py-3.5">
        <button type="button" aria-label="撮る" disabled={!ready} onClick={capture}
          className="h-20 w-20 rounded-full border-4 border-[var(--hp-ink2)] bg-[var(--hp-ink)] ring-4 ring-[var(--hp-panel)] disabled:opacity-40" />
      </footer>}
    </div>
  </Dialog>;
}
