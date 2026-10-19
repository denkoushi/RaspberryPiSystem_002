import { useEffect, useRef, useState } from 'react';

import { disposeVoiceSession, startVoiceTranscription } from '../../voice/voiceTranscription';

import { normalizeSpokenSeiban } from './normalizeSpokenSeiban';

import type { VoiceSession } from '../../voice/voiceTranscription';

export function useSeibanVoiceInput(value: string, enabled: boolean, onApply: (value: string) => void) {
  const [status, setStatus] = useState<'idle' | 'recording' | 'processing'>('idle');
  const [error, setError] = useState('');
  const sessionRef = useRef<VoiceSession | null>(null);
  const latest = useRef({ value, enabled, onApply });
  latest.current = { value, enabled, onApply };

  const cancel = () => {
    if (sessionRef.current) disposeVoiceSession(sessionRef.current);
    sessionRef.current = null;
  };
  useEffect(() => {
    setStatus('idle'); setError('');
    return cancel;
  }, [value, enabled]);

  const manualEdit = () => { cancel(); setStatus('idle'); setError(''); };
  const start = async () => {
    if (!enabled || sessionRef.current) return;
    const session: VoiceSession = { abort: new AbortController() };
    sessionRef.current = session;
    const active = () => sessionRef.current === session && !session.abort.signal.aborted && latest.current.enabled && latest.current.value === value;
    const finish = () => { sessionRef.current = null; setStatus('idle'); };
    setError(''); setStatus('recording');
    await startVoiceTranscription(session, active, () => setStatus('processing'), text => {
      const seiban = normalizeSpokenSeiban(text);
      if (seiban === null) setError('聞き取れませんでした');
      else latest.current.onApply(seiban);
      finish();
    }, message => {
      if (!active()) return;
      setError(message === 'マイクを使えません' || message === '聞き取れませんでした' ? message : '音声入力に失敗しました');
      finish();
    });
  };
  const stop = () => {
    const session = sessionRef.current;
    if (session?.recorder?.state === 'recording') session.recorder.stop();
    else if (session && !session.recorder) { cancel(); setStatus('idle'); }
  };
  return { status, error, start, stop, manualEdit };
}
