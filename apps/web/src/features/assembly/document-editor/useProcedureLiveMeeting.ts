import { useEffect, useRef, useState } from 'react';

import { getResolvedClientKey } from '../../../api/client';
import { getAssemblyProcedureMeetingLiveAvailability } from '../../../api/domains/assembly';
import { OVERLAY_TEXT_PLACEHOLDER } from '../../overlays/overlayDraft';

import { PROCEDURE_TEXT_MAX_LENGTH } from './assemblyDocumentEditorDraft';

import type { OverlayTextElement } from '@raspi-system/shared-types';

const SAME_LINE_SECONDS = 4;
const FINISH_TIMEOUT_MS = 30_000;
const FAILURE_MESSAGE = '書き起こしができませんでした';

const WORKLET_SOURCE = `
class Pcm extends AudioWorkletProcessor {
  constructor() { super(); this.ratio = sampleRate / 16000; this.pos = 0; this.out = []; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      while (this.pos < ch.length) {
        const i = Math.floor(this.pos), f = this.pos - i;
        const v = i + 1 < ch.length ? ch[i] * (1 - f) + ch[i + 1] * f : ch[i];
        this.out.push(Math.max(-1, Math.min(1, v)));
        this.pos += this.ratio;
      }
      this.pos -= ch.length;
      if (this.out.length >= 1600) {
        const b = new Int16Array(this.out.length);
        for (let k = 0; k < b.length; k++) b[k] = this.out[k] * 32767;
        this.port.postMessage(b.buffer, [b.buffer]);
        this.out = [];
      }
    }
    return true;
  }
}
registerProcessor('pcm', Pcm);
`;

type LiveSession = {
  targetId: string;
  before: string;
  last: { spk: number; t: number } | null;
  written: string | null;
  stopped: boolean;
  finished: boolean;
  failed: boolean;
  queue: Array<ArrayBuffer | string>;
  ws?: WebSocket;
  stream?: MediaStream;
  context?: AudioContext;
  node?: AudioWorkletNode;
  timer?: ReturnType<typeof setTimeout>;
};

export function liveMeetingUrl(clientKey: string) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/api/assembly/procedure-documents/meeting-live?clientKey=${encodeURIComponent(clientKey)}`;
}

function releaseAudio(session: LiveSession) {
  if (session.node) session.node.port.onmessage = null;
  try { session.node?.disconnect(); } catch { /* already released */ }
  session.stream?.getTracks().forEach(track => track.stop());
  void session.context?.close().catch(() => {});
  session.node = undefined; session.stream = undefined; session.context = undefined;
}

export function useProcedureLiveMeeting({ element, enabled, disabled, onUpdate, onBegin, onEnd }: {
  element: OverlayTextElement | null;
  enabled: boolean;
  disabled: boolean;
  onUpdate: (element: OverlayTextElement) => void;
  onBegin?: () => void;
  onEnd?: () => void;
}) {
  const [available, setAvailable] = useState(false);
  const [status, setStatus] = useState<'idle' | 'recording' | 'processing'>('idle');
  const [targetId, setTargetId] = useState<string>();
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [error, setError] = useState('');
  const [previous, setPrevious] = useState<{ text: string; applied: string } | null>(null);
  const sessionRef = useRef<LiveSession | null>(null);
  const latest = useRef({ element, onUpdate, onEnd });
  latest.current = { element, onUpdate, onEnd };

  useEffect(() => {
    if (!enabled) return;
    const abort = new AbortController();
    void getAssemblyProcedureMeetingLiveAvailability(abort.signal).then(result => {
      if (!abort.signal.aborted) setAvailable(result);
    }).catch(() => {});
    return () => { abort.abort(); setAvailable(false); };
  }, [enabled]);

  const finish = (session: LiveSession, message?: string) => {
    if (session.finished) return;
    session.finished = true;
    clearTimeout(session.timer);
    releaseAudio(session);
    const ws = session.ws;
    if (ws) {
      ws.onmessage = null; ws.onerror = null; ws.onclose = null;
      try { ws.close(); } catch { /* already closed */ }
    }
    if (sessionRef.current === session) sessionRef.current = null;
    if (message) setError(message);
    setStatus('idle');
    latest.current.onEnd?.();
  };

  const handleEvent = (session: LiveSession, raw: unknown) => {
    if (session.finished || typeof raw !== 'string') return;
    let data: { spk?: unknown; text?: unknown; t?: unknown; error?: unknown };
    try { data = JSON.parse(raw); } catch { return; }
    if (typeof data.error === 'string') {
      session.failed = true;
      finish(session, data.error === 'busy' ? '混んでいます' : FAILURE_MESSAGE);
      return;
    }
    if (typeof data.text !== 'string' || typeof data.spk !== 'number') return;
    const current = latest.current.element;
    if (!current || current.id !== session.targetId) { finish(session, FAILURE_MESSAGE); return; }
    const text = data.text.trim();
    if (!text) return;
    const t = typeof data.t === 'number' ? data.t : 0;
    const base = current.text.trim() === '' || current.text.trim() === OVERLAY_TEXT_PLACEHOLDER ? '' : current.text;
    const sameLine = session.last !== null && session.last.spk === data.spk && t - session.last.t < SAME_LINE_SECONDS && base !== '';
    const next = sameLine ? base + text : `${base ? `${base}\n` : ''}話者${data.spk}: ${text}`;
    if (next.length > PROCEDURE_TEXT_MAX_LENGTH) { finish(session, '長すぎます'); return; }
    session.last = { spk: data.spk, t };
    session.written = next;
    const updated = { ...current, text: next };
    latest.current.element = updated;
    latest.current.onUpdate(updated);
    setPrevious(value => ({ text: value?.text ?? session.before, applied: next }));
  };

  const start = async () => {
    const target = latest.current.element;
    if (!target || !enabled || disabled || !available || sessionRef.current) return;
    const clientKey = getResolvedClientKey();
    const session: LiveSession = {
      targetId: target.id, before: target.text, last: null, written: null,
      stopped: false, finished: false, failed: false, queue: []
    };
    sessionRef.current = session;
    setTargetId(target.id); setError(''); setPrevious(null); setElapsedSeconds(0); setStatus('recording');
    onBegin?.();
    try {
      if (!clientKey) throw new Error('client key');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: true }
      });
      session.stream = stream;
      if (session.finished || session.stopped) { finish(session); return; }
      const context = new AudioContext({ sampleRate: 16000, sinkId: { type: 'none' } } as AudioContextOptions);
      session.context = context;
      const moduleUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }));
      try { await context.audioWorklet.addModule(moduleUrl); } finally { URL.revokeObjectURL(moduleUrl); }
      if (session.finished || session.stopped) { finish(session); return; }
      const source = context.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(context, 'pcm');
      session.node = node;
      const ws = new WebSocket(liveMeetingUrl(clientKey));
      ws.binaryType = 'arraybuffer';
      session.ws = ws;
      ws.onopen = () => { for (const item of session.queue.splice(0)) ws.send(item); };
      ws.onmessage = event => handleEvent(session, event.data);
      ws.onerror = () => { if (!session.finished) { session.failed = true; finish(session, FAILURE_MESSAGE); } };
      ws.onclose = () => {
        if (session.finished) return;
        finish(session, session.stopped ? undefined : FAILURE_MESSAGE);
      };
      node.port.onmessage = event => {
        if (session.finished || session.stopped) return;
        if (ws.readyState === WebSocket.OPEN) ws.send(event.data as ArrayBuffer);
        else if (ws.readyState === WebSocket.CONNECTING && session.queue.length < 600) session.queue.push(event.data as ArrayBuffer);
      };
      source.connect(node);
      node.connect(context.destination);
    } catch {
      finish(session, FAILURE_MESSAGE);
    }
  };

  const stop = () => {
    const session = sessionRef.current;
    if (!session || session.stopped || session.finished) return;
    session.stopped = true;
    const ws = session.ws;
    if (!ws) { finish(session); return; }
    if (ws.readyState === WebSocket.OPEN) ws.send('end');
    else if (ws.readyState === WebSocket.CONNECTING) session.queue.push('end');
    else { finish(session); return; }
    releaseAudio(session);
    setStatus('processing');
    session.timer = setTimeout(() => finish(session), FINISH_TIMEOUT_MS);
  };

  useEffect(() => {
    const session = sessionRef.current;
    if (!session) return;
    if (!enabled || disabled || element?.id !== session.targetId) finish(session, FAILURE_MESSAGE);
  });

  useEffect(() => () => {
    const session = sessionRef.current;
    if (session) { session.stopped = true; finish(session); }
  }, []);

  useEffect(() => {
    if (status !== 'recording') return;
    const startedAt = Date.now();
    const timer = setInterval(() => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [status]);

  const selected = element !== null && element.id === targetId;
  const canRestore = status === 'idle' && selected && previous !== null && previous.applied === element.text;
  const restore = () => {
    if (!element || !canRestore || !previous) return;
    onUpdate({ ...element, text: previous.text });
    setPrevious(null); setError('');
  };
  return {
    available: enabled && available, status: selected ? status : 'idle' as const, locked: status !== 'idle',
    elapsedSeconds, error: selected ? error : '', canRestore, start, stop, restore
  };
}
