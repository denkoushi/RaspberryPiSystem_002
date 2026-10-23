import { useEffect, useRef, useState } from 'react';

import { rewriteAssemblyProcedureDictation } from '../../../api/domains/assembly';
import { disposeVoiceSession, startVoiceTranscription } from '../../voice/voiceTranscription';

import type { ProcedureDictationMode } from '../../../api/domains/assembly';
import type { VoiceSession } from '../../voice/voiceTranscription';
import type { OverlayTextElement } from '@raspi-system/shared-types';

export { WHISPER_BASE_URL as PROCEDURE_WHISPER_BASE_URL } from '../../voice/voiceTranscription';
export const PROCEDURE_DICTATION_REWRITE_TIMEOUT_MS = 20000;

export function useProcedureVoiceInput(element: OverlayTextElement | null, enabled: boolean, onUpdate: (element: OverlayTextElement) => void, context?: string) {
  const [status, setStatus] = useState<'idle' | 'recording' | 'processing'>('idle');
  const [error, setError] = useState('');
  const [transcript, setTranscript] = useState('');
  const [previous, setPrevious] = useState<{ text: string; applied: string } | null>(null);
  const sessionRef = useRef<VoiceSession | null>(null);
  const latest = useRef({ element, enabled, onUpdate });
  latest.current = { element, enabled, onUpdate };

  const cancel = () => {
    if (sessionRef.current) disposeVoiceSession(sessionRef.current);
    sessionRef.current = null;
  };
  useEffect(() => {
    setStatus('idle'); setError(''); setTranscript(''); setPrevious(null);
    return () => {
      if (sessionRef.current) disposeVoiceSession(sessionRef.current);
      sessionRef.current = null;
    };
  }, [element?.id, enabled]);

  const manualEdit = () => {
    cancel(); setStatus('idle'); setPrevious(null); setError(''); setTranscript('');
  };
  const start = async (mode: ProcedureDictationMode) => {
    if (!element || !enabled || sessionRef.current) return;
    const original = element;
    const session: VoiceSession = { abort: new AbortController() };
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
    await startVoiceTranscription(session, active, () => setStatus('processing'), async (spokenText) => {
      setTranscript(spokenText);
      // The in-house LLM may still be loading; never keep the operator waiting on it.
      const limit = new AbortController();
      const onAbort = () => limit.abort();
      session.abort.signal.addEventListener('abort', onAbort, { once: true });
      const limitTimer = setTimeout(onAbort, PROCEDURE_DICTATION_REWRITE_TIMEOUT_MS);
      try {
        const result = await rewriteAssemblyProcedureDictation({ mode, spokenText, currentText: mode === 'new' ? undefined : original.text, signal: limit.signal });
        apply(result.text);
      } catch {
        if (active()) {
          if (mode === 'revise') setError('直せませんでした');
          else if (apply(spokenText)) setError('そのまま入れました');
        }
      } finally {
        clearTimeout(limitTimer);
        session.abort.signal.removeEventListener('abort', onAbort);
        finish();
      }
    }, (message) => { if (active()) setError(message); finish(); }, context);
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
