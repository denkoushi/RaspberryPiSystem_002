import { useCallback, useEffect, useRef, useState } from 'react';

import { stopCameraStream } from '../../utils/camera';

import { CAMERA_QUALITY } from './helpers';

import type { CameraQuality } from './helpers';

export function useBenchCamera(onStop: () => void, quality: CameraQuality) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const generation = useRef(0);
  const pending = useRef(false);
  const firstFrameCleanup = useRef<() => void>(() => {});
  const [status, setStatus] = useState<'off' | 'starting' | 'ready'>('off');
  const [startMs, setStartMs] = useState<number | null>(null);
  const [resolution, setResolution] = useState('—');
  const [error, setError] = useState<string | null>(null);

  const stop = useCallback(() => {
    generation.current++;
    pending.current = false;
    firstFrameCleanup.current();
    onStop();
    stopCameraStream(streamRef.current);
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setStatus('off');
  }, [onStop]);

  const start = useCallback(async () => {
    if (pending.current || streamRef.current || document.hidden) return;
    const video = videoRef.current;
    if (!video) return;
    const id = ++generation.current;
    pending.current = true;
    setStatus('starting');
    setError(null);
    setStartMs(null);
    setResolution('—');
    const t0 = performance.now();
    try {
      // Own stream so both engines share one preview; quality selects production-equal or high resolution.
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', ...CAMERA_QUALITY[quality].video },
        audio: false,
      });
      if (generation.current !== id) {
        stopCameraStream(stream);
        return;
      }
      streamRef.current = stream;
      const ready = () => {
        if (generation.current !== id) return;
        firstFrameCleanup.current();
        pending.current = false;
        setStartMs(performance.now() - t0);
        setResolution(`${video.videoWidth} × ${video.videoHeight}`);
        setStatus('ready');
      };
      if (typeof video.requestVideoFrameCallback === 'function') {
        const frame = video.requestVideoFrameCallback(ready);
        firstFrameCleanup.current = () => video.cancelVideoFrameCallback(frame);
      } else {
        video.addEventListener('playing', ready, { once: true });
        firstFrameCleanup.current = () => video.removeEventListener('playing', ready);
      }
      video.srcObject = stream;
      await video.play();
    } catch {
      if (generation.current !== id) return;
      stop();
      setError('カメラを使えません。権限とHTTPS接続を確認してください');
    }
  }, [stop, quality]);

  // Changing quality needs a new stream; the user restarts it with 「カメラ開始」.
  useEffect(() => { stop(); }, [quality, stop]);

  useEffect(() => {
    const onHidden = () => { if (document.hidden) stop(); };
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      stop();
    };
  }, [stop]);

  return { videoRef, status, start, startMs, resolution, error };
}
