import { isAxiosError } from 'axios';
import { useEffect, useRef, useState } from 'react';

import { getAssemblyProcedureSpeechToTextAvailability, rewriteAssemblyProcedureDictation, transcribeAssemblyProcedureDictation } from '../../../api/domains/assembly';

import type { ProcedureDictationMode } from '../../../api/domains/assembly';
import type { OverlayTextElement } from '@raspi-system/shared-types';

export const PROCEDURE_WHISPER_BASE_URL = 'http://127.0.0.1:8178';
type Session = { abort: AbortController; stream?: MediaStream; recorder?: MediaRecorder; timer?: ReturnType<typeof setTimeout> };

function dispose(session: Session) {
  session.abort.abort();
  clearTimeout(session.timer);
  if (session.recorder?.state === 'recording') session.recorder.stop();
  session.stream?.getTracks().forEach(track => track.stop());
}

function waitForRetry(seconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const onAbort = () => { clearTimeout(timer); reject(new Error('Aborted')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, seconds * 1000);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export function useProcedureVoiceInput(element: OverlayTextElement | null, enabled: boolean, onUpdate: (element: OverlayTextElement) => void) {
  const [status, setStatus] = useState<'idle' | 'recording' | 'processing'>('idle');
  const [error, setError] = useState('');
  const [transcript, setTranscript] = useState('');
  const [previous, setPrevious] = useState<{ text: string; applied: string } | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const latest = useRef({ element, enabled, onUpdate });
  latest.current = { element, enabled, onUpdate };

  const cancel = () => {
    if (sessionRef.current) dispose(sessionRef.current);
    sessionRef.current = null;
  };
  useEffect(() => {
    setStatus('idle'); setError(''); setTranscript(''); setPrevious(null);
    return () => {
      if (sessionRef.current) dispose(sessionRef.current);
      sessionRef.current = null;
    };
  }, [element?.id, enabled]);

  const manualEdit = () => {
    cancel(); setStatus('idle'); setPrevious(null); setError(''); setTranscript('');
  };
  const start = async (mode: ProcedureDictationMode) => {
    if (!element || !enabled || sessionRef.current) return;
    const original = element;
    const session: Session = { abort: new AbortController() };
    sessionRef.current = session;
    const current = () => sessionRef.current === session && !session.abort.signal.aborted && latest.current.enabled && latest.current.element?.id === original.id;
    // Undo/redo during a session changes the text; never write over that.
    const active = () => current() && latest.current.element?.text === original.text;
    const finish = () => {
      if (!current()) return;
      clearTimeout(session.timer);
      session.stream?.getTracks().forEach(track => track.stop());
      sessionRef.current = null;
      setStatus('idle');
    };
    const apply = (text: string) => {
      if (!active() || !latest.current.element) return false;
      const next = mode === 'append' ? original.text + '\n' + text : text;
      if (next.length > 10000) { setError('長すぎます'); return false; }
      setPrevious({ text: original.text, applied: next });
      latest.current.onUpdate({ ...latest.current.element, text: next });
      return true;
    };
    setError(''); setTranscript(''); setStatus('recording');
    const availability = getAssemblyProcedureSpeechToTextAvailability(session.abort.signal).catch(() => false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      session.stream = stream;
      if (!active()) { stream.getTracks().forEach(track => track.stop()); return; }
      const recorder = new MediaRecorder(stream, {
        audioBitsPerSecond: 64000,
        ...(MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? { mimeType: 'audio/webm;codecs=opus' } : {})
      });
      session.recorder = recorder;
      const chunks: Blob[] = [];
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => {
        if (!active()) return;
        setError('マイクを使えません');
        dispose(session); sessionRef.current = null; setStatus('idle');
      };
      recorder.onstop = async () => {
        clearTimeout(session.timer);
        stream.getTracks().forEach(track => track.stop());
        if (!active()) return;
        setStatus('processing');
        let spokenText: string;
        try {
          const audio = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
          if (await availability) {
            if (!active()) return;
            if (audio.size > 2_000_000) { setError('長すぎます'); finish(); return; }
            let result: { text: string };
            try {
              result = await transcribeAssemblyProcedureDictation(audio, session.abort.signal);
            } catch (error) {
              if (!isAxiosError(error) || error.response?.status !== 429) throw error;
              const header = String(error.response.headers['retry-after'] ?? '');
              const seconds = /^[1-9]\d*$/.test(header) ? Math.min(Number(header), 5) : 2;
              await waitForRetry(seconds, session.abort.signal);
              result = await transcribeAssemblyProcedureDictation(audio, session.abort.signal);
            }
            spokenText = result.text.trim();
          } else {
            if (!active()) return;
            const form = new FormData();
            form.append('file', new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }), 'dictation.webm');
            form.append('response_format', 'json'); form.append('language', 'ja'); form.append('temperature', '0');
            const response = await fetch(`${PROCEDURE_WHISPER_BASE_URL}/inference`, { method: 'POST', body: form, signal: session.abort.signal });
            if (!response.ok) throw new Error('STT unavailable');
            const data = await response.json() as { text?: unknown };
            spokenText = typeof data.text === 'string' ? data.text.trim() : '';
          }
        } catch (error) {
          if (active()) setError(isAxiosError(error) && error.response?.status === 429 ? '混んでいます' : '音声認識が動いていません');
          finish(); return;
        }
        if (!active()) return;
        if (!spokenText) { setError('聞き取れませんでした'); finish(); return; }
        setTranscript(spokenText);
        try {
          const result = await rewriteAssemblyProcedureDictation({ mode, spokenText, currentText: mode === 'new' ? undefined : original.text, signal: session.abort.signal });
          apply(result.text);
        } catch {
          if (active()) {
            if (mode === 'revise') setError('直せませんでした');
            else if (apply(spokenText)) setError('そのまま入れました');
          }
        } finally { finish(); }
      };
      recorder.start();
      session.timer = setTimeout(() => {
        if (active() && recorder.state === 'recording') recorder.stop();
      }, 60000);
    } catch {
      if (active()) {
        setError('マイクを使えません');
        dispose(session); sessionRef.current = null; setStatus('idle');
      }
    }
  };
  const stop = () => {
    const session = sessionRef.current;
    if (session?.recorder?.state === 'recording') session.recorder.stop();
    else if (session && !session.recorder) { cancel(); setStatus('idle'); }
  };
  const canRestore = previous !== null && previous.applied === element?.text;
  const restore = () => {
    if (!element || !canRestore || !previous) return;
    onUpdate({ ...element, text: previous.text });
    setPrevious(null); setTranscript(''); setError('');
  };
  return { status, error, transcript, canRestore, start, stop, restore, manualEdit };
}
