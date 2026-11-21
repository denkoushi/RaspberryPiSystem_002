import { useEffect, useRef, useState } from 'react';

import { getResolvedClientKey } from '../../../api/client';
import { getAssemblyProcedureMeetingLiveAvailability } from '../../../api/domains/assembly';
import { isOverlayTextBlankOrPlaceholder } from '../../overlays/overlayDraft';

import { PROCEDURE_TEXT_MAX_LENGTH } from './assemblyDocumentEditorDraft';

import type { OverlayTextElement } from '@raspi-system/shared-types';

const FINISH_TIMEOUT_MS = 60_000;
const TERMS_MAX_CHARS = 200;
const RECORD_HEADER = '【発言記録】';
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
  prefix: string;
  doc: string;
  finals: Array<{ id: number; text: string }>;
  partial: { id: number; text: string } | null;
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
  return `${protocol}//${window.location.host}/api/assembly/procedure-documents/meeting-live?clientKey=${encodeURIComponent(clientKey)}&v=2`;
}

/** Joins the organised document and the raw lines; drops the oldest raw lines to fit the limit. */
export function composeLiveText(prefix: string, doc: string, lines: string[]): string | null {
  const head = [prefix, doc].filter(Boolean).join('\n\n');
  for (let from = 0; from <= lines.length; from++) {
    const rest = lines.slice(from);
    const records = rest.length > 0 ? `${RECORD_HEADER}\n${rest.join('\n')}` : '';
    const text = [head, records].filter(Boolean).join('\n\n');
    if (text.length <= PROCEDURE_TEXT_MAX_LENGTH) return text;
  }
  return null;
}

function releaseAudio(session: LiveSession) {
  if (session.node) session.node.port.onmessage = null;
  try { session.node?.disconnect(); } catch { /* already released */ }
  session.stream?.getTracks().forEach(track => track.stop());
  void session.context?.close().catch(() => {});
  session.node = undefined; session.stream = undefined; session.context = undefined;
}

export function useProcedureLiveMeeting({ element, enabled, disabled, onUpdate, onBegin, onEnd, getTerms }: {
  element: OverlayTextElement | null;
  getTerms?: () => string;
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
  const [next, setNext] = useState('');
  const sessionRef = useRef<LiveSession | null>(null);
  const latest = useRef({ element, onUpdate, onEnd, getTerms });
  latest.current = { element, onUpdate, onEnd, getTerms };

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
    setNext('');
    setStatus('idle');
    latest.current.onEnd?.();
  };

  const write = (session: LiveSession) => {
    const current = latest.current.element;
    if (!current || current.id !== session.targetId) { finish(session, FAILURE_MESSAGE); return; }
    const lines = session.finals.map(item => item.text);
    if (session.partial) lines.push(session.partial.text);
    const next = composeLiveText(session.prefix, session.doc, lines);
    if (next === null) { finish(session, '長すぎます'); return; }
    if (next === current.text) return;
    session.written = next;
    const updated = { ...current, text: next };
    latest.current.element = updated;
    latest.current.onUpdate(updated);
    setPrevious(value => ({ text: value?.text ?? session.before, applied: next }));
  };

  const handleEvent = (session: LiveSession, raw: unknown) => {
    if (session.finished || typeof raw !== 'string') return;
    let data: { type?: unknown; id?: unknown; text?: unknown; next?: unknown; error?: unknown };
    try { data = JSON.parse(raw); } catch { return; }
    if (typeof data.error === 'string') {
      session.failed = true;
      finish(session, data.error === 'busy' ? '混んでいます' : FAILURE_MESSAGE);
      return;
    }
    if (data.type === 'done') {
      if (session.partial) { session.partial = null; write(session); }
      finish(session);
      return;
    }
    const text = typeof data.text === 'string' ? data.text.trim() : '';
    if (data.type === 'doc') {
      if (typeof data.text !== 'string') return;
      if (typeof data.next === 'string' && !session.stopped) setNext(data.next.trim());
      session.doc = text;
      write(session);
      return;
    }
    if (typeof data.id !== 'number' || !text) return;
    const id = data.id;
    if (data.type === 'partial') {
      if (session.finals.some(item => item.id === id)) return;
      session.partial = { id, text };
    } else if (data.type === 'final') {
      session.finals = [...session.finals.filter(item => item.id !== id), { id, text }];
      if (session.partial?.id === id) session.partial = null;
    } else {
      return;
    }
    write(session);
  };

  const start = async () => {
    const target = latest.current.element;
    if (!target || !enabled || disabled || !available || sessionRef.current) return;
    const clientKey = getResolvedClientKey();
    const session: LiveSession = {
      targetId: target.id, before: target.text, prefix: isOverlayTextBlankOrPlaceholder(target.text) ? '' : target.text,
      doc: '', finals: [], partial: null, written: null,
      stopped: false, finished: false, failed: false, queue: []
    };
    sessionRef.current = session;
    setTargetId(target.id); setError(''); setPrevious(null); setNext(''); setElapsedSeconds(0); setStatus('recording');
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
      ws.onopen = () => {
        const terms = (latest.current.getTerms?.() ?? '').replace(/\s+/gu, ' ').trim().slice(0, TERMS_MAX_CHARS);
        if (terms) ws.send(JSON.stringify({ type: 'context', terms }));
        for (const item of session.queue.splice(0)) ws.send(item);
      };
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
    setNext('');
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
    elapsedSeconds, error: selected ? error : '', next: selected && status === 'recording' ? next : '', canRestore, start, stop, restore
  };
}
