import { isAxiosError } from 'axios';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { api, getResolvedClientKey } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { Dialog } from '../../../components/ui/Dialog';
import { useAuth } from '../../../contexts/AuthContext';
import { sendSignalingMessage, subscribeSignaling } from '../../webrtc/signalingBus';

import { normalizeVideoPointer, validPointer } from './pointer';
import { registerWatchStarter } from './startWatch';
import { startCapture as captureDisplay, stopStream, useScreenWatchPeer } from './useScreenWatchPeer';

import type { PointerPosition } from './pointer';
import type { SignalingEvent } from '../../webrtc/signalingBus';
import type { WatchMessage } from '../../webrtc/types';
import type { RefObject } from 'react';
import './screen-watch.css';

type WatchState = { watchId: string; label: string; active: boolean; control: 'off' | 'requested' | 'on' };
type ViewerState = WatchState & { authMethod: 'badge' | 'login' };
type NumberDraft = { field: HTMLInputElement; value: string; committedValue: string };
const allowedKeys = new Set(['Backspace', 'Enter', 'Tab', 'Escape', 'ArrowLeft', 'ArrowRight']);
const printableKey = (key: string) => key.length === 1 && /^[\x20-\x7e]$/.test(key);
const editableInputTypes = new Set(['text', 'search', 'number', 'tel', 'url', 'email']);
const implicitSubmitInputTypes = new Set([...editableInputTypes, 'password', 'date', 'month', 'week', 'time', 'datetime-local']);
const numberValue = /^-?(?:\d+|\d*\.\d+)(?:[eE][+-]?\d+)?$/;
const incompleteNumber = /^(?:-|-?\d*\.|-?(?:\d+|\d*\.\d+)[eE][+-]?)$/;
const remoteKeyEvents = new WeakSet<KeyboardEvent>();
const watchUi = '.screen-watch__viewer, .screen-watch__target-pill, .screen-watch__consent-overlay, .screen-watch__notice';
const focusableSelector = 'a[href], button, input, select, textarea, [tabindex], [contenteditable="true"], [contenteditable=""], summary, audio[controls], video[controls]';

function canFocus(element: HTMLElement) {
  return !element.matches(':disabled, input[type="hidden"]') && !element.closest('[inert], [hidden], ' + watchUi)
    && element.checkVisibility?.({ visibilityProperty: true }) !== false;
}

function clickScreenPoint({ x, y }: PointerPosition) {
  const clientX = x * window.innerWidth;
  const clientY = y * window.innerHeight;
  const element = document.elementFromPoint(clientX, clientY);
  if (!element || element.closest(watchUi)) return;
  const event = { clientX, clientY, bubbles: true, cancelable: true };
  const pointer = { ...event, pointerId: 1, pointerType: 'mouse', isPrimary: true };
  element.dispatchEvent(new PointerEvent('pointerdown', { ...pointer, buttons: 1 }));
  element.dispatchEvent(new MouseEvent('mousedown', { ...event, buttons: 1 }));
  const previous = document.activeElement;
  const candidate = element.closest<HTMLElement>(focusableSelector);
  const focusTarget = candidate && canFocus(candidate) ? candidate : null;
  focusTarget?.focus();
  if (previous instanceof HTMLElement && previous === document.activeElement && previous !== focusTarget) previous.blur();
  element.dispatchEvent(new PointerEvent('pointerup', pointer));
  element.dispatchEvent(new MouseEvent('mouseup', event));
  element.dispatchEvent(new MouseEvent('click', event));
}

function submitFromInput(form: HTMLFormElement) {
  const submitter = Array.from(form.ownerDocument.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button, input[type="submit"]'))
    .find(element => element.form === form && element.type === 'submit');
  if (submitter) {
    if (!submitter.matches(':disabled')) submitter.click();
    return;
  }
  const fields = Array.from(form.elements).filter(element =>
    element instanceof HTMLInputElement && implicitSubmitInputTypes.has(element.type));
  if (fields.length === 1) form.requestSubmit();
}

function focusNext(active: Element | null) {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>(focusableSelector)).filter(canFocus);
  const tabbable = candidates.filter(element => element.tabIndex >= 0 || (element.isContentEditable && !element.hasAttribute('tabindex')));
  const ordered = [
    ...tabbable.filter(element => element.tabIndex > 0).sort((a, b) => a.tabIndex - b.tabIndex),
    ...tabbable.filter(element => element.tabIndex <= 0)
  ];
  const index = ordered.findIndex(element => element === active);
  const next = index >= 0 ? ordered[index + 1] : ordered.find(element =>
    element.tabIndex > 0 || !active || Boolean(active.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING));
  (next ?? ordered[0])?.focus();
}

function dispatchScreenKey(element: Element, key: string) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  remoteKeyEvents.add(event);
  return element.dispatchEvent(event);
}

function applyScreenKey(key: string, draft: RefObject<NumberDraft | null>) {
  const field = document.activeElement;
  if (key === 'Tab') {
    if (!field || field.closest(watchUi) || dispatchScreenKey(field, key)) focusNext(field);
    return;
  }
  if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) return;
  const isInput = field instanceof HTMLInputElement;
  if ((isInput && !editableInputTypes.has(field.type)) || field.matches(':disabled') || field.closest(watchUi)) return;
  if (key !== 'Backspace' && !printableKey(key)) {
    if (!dispatchScreenKey(field, key)) return;
    if (key === 'Enter') {
      if (isInput) {
        if (field.form) submitFromInput(field.form);
        return;
      }
    } else {
      const { selectionStart: start, selectionEnd: end } = field;
      if ((key === 'ArrowLeft' || key === 'ArrowRight') && start !== null && end !== null) {
        const step = start === end ? 1 : 0;
        const caret = key === 'ArrowLeft' ? Math.max(0, start - step) : Math.min(field.value.length, end + step);
        field.setSelectionRange(caret, caret);
      }
      return;
    }
  }
  if (field.readOnly) return;
  const { value: committedValue, selectionStart, selectionEnd } = field;
  const numberField = isInput && field.type === 'number';
  const previousDraft = draft.current;
  const value = numberField && previousDraft?.field === field && previousDraft.committedValue === committedValue
    ? previousDraft.value : committedValue;
  const start = selectionStart ?? value.length;
  const end = selectionEnd ?? start;
  const inserted = key === 'Backspace' ? '' : key === 'Enter' ? '\n' : key;
  const from = key === 'Backspace' && start === end ? start - (Array.from(value.slice(0, start)).at(-1)?.length ?? 0) : start;
  const nextValue = value.slice(0, from) + inserted + value.slice(end);
  if (value === nextValue || (inserted && field.maxLength >= 0 && nextValue.length > field.maxLength)) return;
  if (numberField) {
    // Number inputs sanitize incomplete values before React can observe them.
    if (incompleteNumber.test(nextValue)) {
      draft.current = { field, value: nextValue, committedValue };
      return;
    }
    if (nextValue && (!numberValue.test(nextValue) || !Number.isFinite(Number(nextValue)))) return;
    draft.current = null;
    if (nextValue === committedValue) return;
  }
  const prototype = isInput ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(field, nextValue);
  if (selectionStart !== null) field.setSelectionRange(from + inserted.length, from + inserted.length);
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

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
  const { user, token } = useAuth();
  const canWatchWithLogin = Boolean(token && (user?.role === 'ADMIN' || user?.role === 'MANAGER'));
  const [target, setTarget] = useState<WatchState | null>(null);
  const [viewer, setViewer] = useState<ViewerState | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [notice, setNotice] = useState('');
  const [pointing, setPointing] = useState(false);
  const [ring, setRing] = useState<{ x: number; y: number; role: 'target' | 'viewer' } | null>(null);
  const [cursor, setCursor] = useState<PointerPosition | null>(null);
  const [ripple, setRipple] = useState<(PointerPosition & { at: number }) | null>(null);
  const lastPointer = useRef(-Infinity);
  const lastMove = useRef(-Infinity);
  const viewerSignals = useRef<WatchMessage['payload'][]>([]);
  const targetRef = useRef(target);
  const viewerRef = useRef(viewer);
  const capturePending = useRef(false);
  const pendingRequest = useRef(false);
  const cancelledRequest = useRef(false);
  const buffered = useRef<SignalingEvent[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const denyControlRef = useRef<HTMLButtonElement>(null);
  const numberDraft = useRef<NumberDraft | null>(null);

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
    if (value?.control !== 'on') { numberDraft.current = null; setCursor(null); setRipple(null); }
    targetRef.current = value; setTarget(value);
  }, [targetPeer]);
  const updateViewer = useCallback((value: ViewerState | null) => {
    if (!value) { viewerPeer.close(); viewerSignals.current = []; setPointing(false); setRing(null); }
    viewerRef.current = value; setViewer(value);
  }, [viewerPeer]);
  const stop = useCallback((role: 'viewer' | 'target') => {
    const session = role === 'viewer' ? viewerRef.current : targetRef.current;
    if (session?.watchId && !sendSignalingMessage({ type: 'watch.stop', payload: { watchId: session.watchId } })) setNotice('接続が切れました');
    if (role === 'viewer') { cancelledRequest.current = true; updateViewer(null); } else updateTarget(null);
  }, [updateTarget, updateViewer]);

  useEffect(() => {
    if (viewer?.authMethod === 'login' && !canWatchWithLogin) stop('viewer');
  }, [canWatchWithLogin, stop, viewer]);
  useEffect(() => {
    if (viewer?.control !== 'requested') return;
    const timer = window.setTimeout(() => {
      if (viewerRef.current !== viewer) return;
      sendSignalingMessage({ type: 'watch.control.stop', payload: { watchId: viewer.watchId } });
      updateViewer({ ...viewer, control: 'off' });
      setNotice(stoppedText('timeout'));
    }, 30_000);
    return () => window.clearTimeout(timer);
  }, [updateViewer, viewer]);

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
    if (!ripple) return;
    const timer = window.setTimeout(() => setRipple(null), 400);
    return () => window.clearTimeout(timer);
  }, [ripple]);

  const viewerOperating = viewer?.control === 'on';
  useEffect(() => {
    if (!viewerOperating) return;
    const forwardKey = (event: KeyboardEvent) => {
      const session = viewerRef.current;
      if (session?.control !== 'on' || event.isComposing || event.ctrlKey || event.metaKey || event.altKey
        || (event.key === 'Tab' && event.shiftKey) || remoteKeyEvents.has(event)
        || (!printableKey(event.key) && !allowedKeys.has(event.key))) return;
      event.preventDefault();
      event.stopPropagation();
      sendSignalingMessage({ type: 'watch.input', payload: { watchId: session.watchId, kind: 'key', key: event.key } });
    };
    window.addEventListener('keydown', forwardKey, true);
    return () => window.removeEventListener('keydown', forwardKey, true);
  }, [viewerOperating]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    let mounted = true;
    const clearNumberDraft = (event: FocusEvent) => {
      if (numberDraft.current?.field === event.target) numberDraft.current = null;
    };
    document.addEventListener('blur', clearNumberDraft, true);
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
        updateTarget({ watchId: payload.watchId, label: payload.viewerName, active: false, control: 'off' });
        return;
      }
      if (pendingRequest.current && !viewerRef.current?.watchId) buffered.current.push(message);
      const targetSession = targetRef.current;
      const viewerSession = viewerRef.current;
      if (message.type === 'error' && typeof payload.requestType === 'string') {
        // Late input or consent can cross a stop notification while the video is still active.
        if (payload.requestType === 'watch.control.request' && viewerSession?.watchId === payload.watchId && viewerSession.control === 'requested') {
          updateViewer({ ...viewerSession, control: 'off' });
        }
        if (payload.requestType === 'watch.control.accept' && targetSession?.watchId === payload.watchId) {
          updateTarget({ ...targetSession, control: 'off' });
        }
        return;
      }
      if (targetSession?.watchId === payload.watchId && targetSession.active) {
        if (message.type === 'watch.signal') targetPeer.signal(payload);
        if (message.type === 'watch.pointer' && targetSession.control !== 'on' && validPointer(payload)) setRing({ ...payload, role: 'target' });
        if (message.type === 'watch.control.request' && targetSession.control === 'off') {
          updateTarget({ ...targetSession, control: 'requested' });
        }
        if (message.type === 'watch.control.stopped') updateTarget({ ...targetSession, control: 'off' });
        if (message.type === 'watch.input' && targetSession.control === 'on') {
          if (payload.kind === 'key' && typeof payload.key === 'string' && (printableKey(payload.key) || allowedKeys.has(payload.key))) {
            applyScreenKey(payload.key, numberDraft);
          } else if ((payload.kind === 'move' || payload.kind === 'click') && validPointer(payload)) {
            const point = { x: payload.x, y: payload.y };
            setCursor(point);
            if (payload.kind === 'click') {
              setRipple({ ...point, at: performance.now() });
              clickScreenPoint(point);
            }
          }
        }
      }
      if (targetRef.current?.watchId === payload.watchId && (message.type === 'watch.stopped' || message.type === 'watch.denied' || message.type === 'error')) {
        updateTarget(null);
        if (message.type === 'error') setNotice('画面を見せられませんでした');
      }
      if (viewerSession?.watchId !== payload.watchId) return;
      if (message.type === 'watch.signal') {
        if (viewerSession.active) viewerPeer.signal(payload);
        else viewerSignals.current.push(payload);
      }
      if (message.type === 'watch.accepted' && !viewerSession.active) {
        try {
          viewerPeer.start(payload.watchId, 'viewer');
          updateViewer({ ...viewerSession, active: true });
          for (const signal of viewerSignals.current.splice(0)) viewerPeer.signal(signal);
        } catch {
          sendSignalingMessage({ type: 'watch.stop', payload: { watchId: payload.watchId } });
          updateViewer(null); setNotice('映像が届きませんでした');
        }
      }
      if (message.type === 'watch.control.accepted' && viewerSession.control === 'requested') {
        lastMove.current = -Infinity;
        updateViewer({ ...viewerSession, control: 'on' });
      }
      if (message.type === 'watch.control.denied' && viewerSession.control === 'requested') {
        updateViewer({ ...viewerSession, control: 'off' });
        setNotice('断られました');
      }
      if (message.type === 'watch.control.stopped') updateViewer({ ...viewerSession, control: 'off' });
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
      const session: ViewerState = { watchId: '', label: targetLabel, active: false, control: 'off',
        authMethod: employeeTagUid ? 'badge' : 'login' };
      updateViewer(session);
      try {
        const { data } = await api.post<{ watchId: string }>(`/kiosk/inquiries/${encodeURIComponent(threadId)}/watch`,
          employeeTagUid ? { employeeTagUid } : {}, { headers: { 'x-client-key': clientKey } });
        if (!mounted || cancelledRequest.current) {
          sendSignalingMessage({ type: 'watch.stop', payload: { watchId: data.watchId } });
          return;
        }
        updateViewer({ ...session, watchId: data.watchId });
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
      document.removeEventListener('blur', clearNumberDraft, true);
      unregister(); unsubscribe();
      for (const session of [targetRef.current, viewerRef.current]) {
        if (session?.watchId) sendSignalingMessage({ type: 'watch.stop', payload: { watchId: session.watchId } });
      }
      targetPeer.close(); viewerPeer.close();
      targetRef.current = null; viewerRef.current = null;
    };
  }, [clientKey, targetPeer, viewerPeer, updateTarget, updateViewer]);

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

  const respondToControl = (accepted: boolean) => {
    const session = targetRef.current;
    if (session?.control !== 'requested') return;
    const sent = sendSignalingMessage({
      type: accepted ? 'watch.control.accept' : 'watch.control.deny', payload: { watchId: session.watchId }
    });
    if (!sent) setNotice('接続が切れました');
    if (accepted && sent) setRing(null);
    updateTarget({ ...session, control: accepted && sent ? 'on' : 'off' });
  };

  const stopControl = (role: 'viewer' | 'target') => {
    const viewerSession = role === 'viewer' ? viewerRef.current : null;
    const targetSession = role === 'target' ? targetRef.current : null;
    const session = viewerSession ?? targetSession;
    if (!session) return;
    if (!sendSignalingMessage({ type: 'watch.control.stop', payload: { watchId: session.watchId } })) setNotice('接続が切れました');
    if (viewerSession) updateViewer({ ...viewerSession, control: 'off' });
    if (targetSession) updateTarget({ ...targetSession, control: 'off' });
  };

  const toggleControl = () => {
    const session = viewerRef.current;
    if (!session?.active || session.control === 'requested') return;
    if (session.control === 'on') {
      stopControl('viewer');
      return;
    }
    if (sendSignalingMessage({ type: 'watch.control.request', payload: { watchId: session.watchId } })) {
      setPointing(false); setRing(null);
      updateViewer({ ...session, control: 'requested' });
    } else {
      setNotice('接続が切れました');
    }
  };

  const togglePointing = () => {
    const session = viewerRef.current;
    if (!pointing && session && session.control !== 'off') stopControl('viewer');
    setPointing(!pointing);
  };

  const inputAtVideo = (event: React.MouseEvent<HTMLVideoElement>, kind: 'click' | 'move') => {
    const video = event.currentTarget;
    const session = viewerRef.current;
    if (!session?.active) return;
    const operating = session.control === 'on';
    const now = performance.now();
    if (operating ? kind === 'move' && now - lastMove.current < 50
      : !pointing || kind === 'move' || now - lastPointer.current < 100) return;
    const point = normalizeVideoPointer(event.clientX, event.clientY, video.getBoundingClientRect(), video.videoWidth, video.videoHeight);
    if (!point) return;
    if (operating) {
      if (kind === 'move') lastMove.current = now;
      sendSignalingMessage({ type: 'watch.input', payload: { watchId: session.watchId, kind, ...point } });
      return;
    }
    lastPointer.current = now;
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
    {target?.control === 'requested' ? <Dialog isOpen onClose={() => respondToControl(false)} title={`${target.label} が この画面を操作します`}
      size="sm" overlayZIndex={130} overlayClassName="screen-watch__consent-overlay" className="screen-watch__consent" closeOnBackdrop={false}
      initialFocusRef={denyControlRef}>
      <div className="screen-watch__actions">
        <Button type="button" onClick={() => respondToControl(true)}>任せる</Button>
        <Button ref={denyControlRef} type="button" variant="ghost" onClick={() => respondToControl(false)}>断る</Button>
      </div>
    </Dialog> : null}
    {target?.active ? <div className={`screen-watch__target-pill${target.control === 'on' ? ' screen-watch__target-pill--operating' : ''}`}>
      <span>{target.label} {target.control === 'on' ? 'が操作しています' : 'が見ています'}</span>
      <button type="button" onClick={() => target.control === 'on' ? stopControl('target') : stop('target')}>止める</button>
    </div> : null}
    {viewer ? <section className={`screen-watch__viewer${viewerOperating ? ' screen-watch__viewer--operating' : ''}`} aria-label="画面を見る">
      {viewer.active ? <video ref={videoRef} className="screen-watch__video" aria-label="画面の映像" autoPlay playsInline muted
        onClick={event => inputAtVideo(event, 'click')} onMouseMove={viewerOperating ? event => inputAtVideo(event, 'move') : undefined} />
        : <p className="screen-watch__waiting" role="status">相手の「見せる」を待っています</p>}
      <div className="screen-watch__viewer-pill">
        {viewer.active ? <>
          <span>● {viewer.label}</span><span>遅れ <output>{delay}</output></span>
          <button type="button" aria-pressed={pointing} onClick={togglePointing}>指さし</button>
          <button type="button" className="screen-watch__operation" aria-pressed={viewerOperating}
            disabled={viewer.control === 'requested'} onClick={toggleControl}>{viewer.control === 'requested' ? '操作…' : '操作'}</button>
        </> : null}
        <button type="button" onClick={() => stop('viewer')}>■ 止める</button>
      </div>
    </section> : null}
    {ring ? <div className="screen-watch__pointer" data-testid="screen-watch-pointer" aria-hidden="true"
      style={{ pointerEvents: 'none', left: ring.role === 'target' ? `${ring.x * 100}vw` : ring.x,
        top: ring.role === 'target' ? `${ring.y * 100}vh` : ring.y }} /> : null}
    {cursor && target?.control === 'on' ? <div className="screen-watch__cursor" aria-hidden="true"
      style={{ left: `${cursor.x * 100}vw`, top: `${cursor.y * 100}vh` }}><span>{target.label}</span></div> : null}
    {ripple ? <div key={ripple.at} className="screen-watch__ripple" aria-hidden="true"
      style={{ left: `${ripple.x * 100}vw`, top: `${ripple.y * 100}vh` }} /> : null}
    {notice ? <div className="screen-watch__notice" role="status">{notice}</div> : null}
  </>;
}
