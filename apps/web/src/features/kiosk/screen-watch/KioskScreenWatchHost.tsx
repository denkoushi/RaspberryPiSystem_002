import { isAxiosError } from 'axios';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { api, getResolvedClientKey } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { Dialog } from '../../../components/ui/Dialog';
import { sendSignalingMessage, subscribeSignaling } from '../../webrtc/signalingBus';

import { normalizeVideoPointer, validPointer } from './pointer';
import { registerWatchStarter } from './startWatch';
import { startCapture as captureDisplay, stopStream, useScreenWatchPeer } from './useScreenWatchPeer';

import type { SignalingEvent } from '../../webrtc/signalingBus';
import type { WatchMessage } from '../../webrtc/types';
import './screen-watch.css';

type WatchState = { watchId: string; label: string; active: boolean };
const stoppedText = (reason?: string) => reason === 'target' ? '相手が止めました'
  : reason === 'timeout' ? '応答がありませんでした'
  : reason === 'NotAllowedError' || reason === 'NotReadableError' ? '相手の端末で 画面を取れませんでした'
  : reason === 'disconnect' || reason === 'stale' ? '接続が切れました' : reason === 'viewer' ? '' : '画面を見られませんでした';

export function KioskScreenWatchHost() {
  const { pathname } = useLocation();
  const [clientKey, setClientKey] = useState(getResolvedClientKey);
  useEffect(() => {
    const check = () => setClientKey(getResolvedClientKey());
    const timer = window.setInterval(check, 2000);
    window.addEventListener('storage', check);
    return () => { window.clearInterval(timer); window.removeEventListener('storage', check); };
  }, []);
  return pathname.startsWith('/kiosk') && clientKey
    ? <ScreenWatchHost key={clientKey} clientKey={clientKey} /> : null;
}

export function ScreenWatchHost({ clientKey, startCapture = captureDisplay }: {
  clientKey: string; startCapture?: () => Promise<MediaStream>;
}) {
  const [target, setTarget] = useState<WatchState | null>(null);
  const [viewer, setViewer] = useState<WatchState | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [notice, setNotice] = useState('');
  const [pointing, setPointing] = useState(false);
  const [ring, setRing] = useState<{ x: number; y: number; role: 'target' | 'viewer' } | null>(null);
  const lastPointer = useRef(-Infinity);
  const viewerSignals = useRef<WatchMessage['payload'][]>([]);
  const targetRef = useRef(target);
  const viewerRef = useRef(viewer);
  const capturePending = useRef(false);
  const pendingRequest = useRef(false);
  const cancelledRequest = useRef(false);
  const buffered = useRef<SignalingEvent[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);

  const { controls: targetPeer } = useScreenWatchPeer(failed => {
    updateTarget(null);
    if (failed) setNotice('画面を見せられませんでした');
  });
  const { controls: viewerPeer, stream, delay } = useScreenWatchPeer(failed => {
    updateViewer(null);
    if (failed) setNotice('映像が届きませんでした');
  });
  const updateTarget = useCallback((value: WatchState | null) => {
    if (!value) { targetPeer.close(); setRing(null); }
    targetRef.current = value; setTarget(value);
  }, [targetPeer]);
  const updateViewer = useCallback((value: WatchState | null) => {
    if (!value) { viewerPeer.close(); viewerSignals.current = []; setPointing(false); setRing(null); }
    viewerRef.current = value; setViewer(value);
  }, [viewerPeer]);

  useEffect(() => {
    const video = videoRef.current;
    if (video) video.srcObject = stream;
    return () => { if (video) video.srcObject = null; };
  }, [stream, viewer?.active]);
  useEffect(() => {
    if (!ring) return;
    const timer = window.setTimeout(() => setRing(null), ring.role === 'target' ? 2500 : 700);
    return () => window.clearTimeout(timer);
  }, [ring]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    let mounted = true;
    const receive = (message: SignalingEvent) => {
      if (message.type === 'connection.closed') {
        cancelledRequest.current = true;
        if (targetRef.current || viewerRef.current) setNotice('接続が切れました');
        updateTarget(null); updateViewer(null);
        return;
      }
      const payload = message.payload as WatchMessage['payload'] | undefined;
      if (!payload || typeof payload.watchId !== 'string') return;
      if (message.type === 'watch.request' && typeof payload.viewerName === 'string') {
        updateTarget({ watchId: payload.watchId, label: payload.viewerName, active: false });
        return;
      }
      if (pendingRequest.current && !viewerRef.current?.watchId) buffered.current.push(message);
      if (targetRef.current?.watchId === payload.watchId && targetRef.current.active) {
        if (message.type === 'watch.signal') targetPeer.signal(payload);
        if (message.type === 'watch.pointer' && validPointer(payload)) setRing({ ...payload, role: 'target' });
      }
      if (targetRef.current?.watchId === payload.watchId && (message.type === 'watch.stopped' || message.type === 'watch.denied' || message.type === 'error')) {
        updateTarget(null);
        if (message.type === 'error') setNotice('画面を見せられませんでした');
      }
      if (viewerRef.current?.watchId !== payload.watchId) return;
      if (message.type === 'watch.signal') {
        if (viewerRef.current.active) viewerPeer.signal(payload);
        else viewerSignals.current.push(payload);
      }
      if (message.type === 'watch.accepted' && !viewerRef.current.active) {
        try {
          viewerPeer.start(payload.watchId, 'viewer');
          updateViewer({ ...viewerRef.current, active: true });
          for (const signal of viewerSignals.current.splice(0)) viewerPeer.signal(signal);
        } catch {
          sendSignalingMessage({ type: 'watch.stop', payload: { watchId: payload.watchId } });
          updateViewer(null); setNotice('映像が届きませんでした');
        }
      }
      if (message.type === 'watch.denied' || message.type === 'watch.stopped' || message.type === 'error') {
        updateViewer(null);
        setNotice(message.type === 'watch.denied' ? '断られました'
          : message.type === 'error' ? '画面を見られませんでした' : stoppedText(payload.reason));
      }
    };
    const unsubscribe = subscribeSignaling('', receive);
    const unregister = registerWatchStarter(async (threadId, employeeTagUid, targetLabel) => {
      if (pendingRequest.current || viewerRef.current) return;
      pendingRequest.current = true;
      cancelledRequest.current = false;
      buffered.current = [];
      setNotice('');
      updateViewer({ watchId: '', label: targetLabel, active: false });
      try {
        const { data } = await api.post<{ watchId: string }>(`/kiosk/inquiries/${encodeURIComponent(threadId)}/watch`,
          { employeeTagUid }, { headers: { 'x-client-key': clientKey } });
        if (!mounted || cancelledRequest.current) {
          sendSignalingMessage({ type: 'watch.stop', payload: { watchId: data.watchId } });
          return;
        }
        updateViewer({ watchId: data.watchId, label: targetLabel, active: false });
        pendingRequest.current = false;
        for (const message of buffered.current) receive(message);
      } catch (error) {
        if (!mounted || cancelledRequest.current) return;
        updateViewer(null);
        const code = isAxiosError(error) ? error.response?.data?.errorCode : undefined;
        setNotice(code === 'KIOSK_SCREEN_WATCH_TARGET_OFFLINE' ? '相手の端末が つながっていません'
          : code === 'KIOSK_SCREEN_WATCH_VIEWER_OFFLINE' ? 'この端末が つながっていません'
          : code === 'KIOSK_SCREEN_WATCH_BUSY' ? 'ほかの人が見ています' : '画面を見られませんでした');
      } finally { pendingRequest.current = false; buffered.current = []; }
    });
    return () => {
      mounted = false;
      cancelledRequest.current = true;
      unregister(); unsubscribe();
      for (const session of [targetRef.current, viewerRef.current]) {
        if (session?.watchId) sendSignalingMessage({ type: 'watch.stop', payload: { watchId: session.watchId } });
      }
      targetPeer.close(); viewerPeer.close();
      targetRef.current = null; viewerRef.current = null;
    };
  }, [clientKey, targetPeer, viewerPeer, updateTarget, updateViewer]);

  const stop = (role: 'viewer' | 'target') => {
    const session = role === 'viewer' ? viewerRef.current : targetRef.current;
    if (session?.watchId && !sendSignalingMessage({ type: 'watch.stop', payload: { watchId: session.watchId } })) setNotice('接続が切れました');
    if (role === 'viewer') { cancelledRequest.current = true; updateViewer(null); } else updateTarget(null);
  };
  const deny = () => {
    const session = targetRef.current;
    if (session) sendSignalingMessage({ type: 'watch.deny', payload: { watchId: session.watchId } });
    updateTarget(null);
  };
  const onShow = async () => {
    const session = targetRef.current;
    if (!session || capturePending.current) return;
    capturePending.current = true; setCapturing(true);
    let captured: MediaStream | undefined;
    try {
      // User activation: no await or signaling before capture starts.
      captured = await startCapture();
      if (targetRef.current?.watchId !== session.watchId) { stopStream(captured); return; }
      if (!sendSignalingMessage({ type: 'watch.accept', payload: { watchId: session.watchId } })) throw new Error('disconnect');
      updateTarget({ ...session, active: true });
      await targetPeer.start(session.watchId, 'target').offer(captured);
    } catch (error) {
      if (captured) stopStream(captured);
      if (targetRef.current?.watchId !== session.watchId) return;
      sendSignalingMessage({ type: 'watch.fail', payload: {
        watchId: session.watchId, reason: error instanceof Error || error instanceof DOMException ? error.name.slice(0, 200) : 'capture'
      } });
      updateTarget(null); setNotice('画面を見せられませんでした');
    } finally { capturePending.current = false; setCapturing(false); }
  };

  const pointAtVideo = (event: React.MouseEvent<HTMLVideoElement>) => {
    const video = event.currentTarget;
    const session = viewerRef.current;
    if (!pointing || !session?.active || performance.now() - lastPointer.current < 100) return;
    const point = normalizeVideoPointer(event.clientX, event.clientY, video.getBoundingClientRect(), video.videoWidth, video.videoHeight);
    if (!point) return;
    lastPointer.current = performance.now();
    sendSignalingMessage({ type: 'watch.pointer', payload: { watchId: session.watchId, ...point } });
    setRing({ x: event.clientX, y: event.clientY, role: 'viewer' });
  };

  return <>
    {target && !target.active ? <Dialog isOpen onClose={deny} title={`${target.label} が この画面を見ます`}
      size="sm" overlayZIndex={130} overlayClassName="screen-watch__consent-overlay" className="screen-watch__consent" closeOnBackdrop={false}>
      <div className="screen-watch__actions">
        <Button type="button" onClick={() => void onShow()} disabled={capturing}>見せる</Button>
        <Button type="button" variant="ghost" onClick={deny}>断る</Button>
      </div>
    </Dialog> : null}
    {target?.active ? <div className="screen-watch__target-pill">
      <span>{target.label} が見ています</span><button type="button" onClick={() => stop('target')}>止める</button>
    </div> : null}
    {viewer ? <section className="screen-watch__viewer" aria-label="画面を見る">
      {viewer.active ? <video ref={videoRef} className="screen-watch__video" aria-label="画面の映像" autoPlay playsInline muted onClick={pointAtVideo} />
        : <p className="screen-watch__waiting" role="status">相手の「見せる」を待っています</p>}
      <div className="screen-watch__viewer-pill">
        {viewer.active ? <><span>● {viewer.label}</span><span>遅れ <output>{delay}</output></span><button type="button" aria-pressed={pointing} onClick={() => setPointing(value => !value)}>指さし</button></> : null}
        <button type="button" onClick={() => stop('viewer')}>■ 止める</button>
      </div>
    </section> : null}
    {ring ? <div className="screen-watch__pointer" data-testid="screen-watch-pointer" aria-hidden="true"
      style={{ pointerEvents: 'none', left: ring.role === 'target' ? `${ring.x * 100}vw` : ring.x,
        top: ring.role === 'target' ? `${ring.y * 100}vh` : ring.y }} /> : null}
    {notice ? <div className="screen-watch__notice" role="status">{notice}</div> : null}
  </>;
}
