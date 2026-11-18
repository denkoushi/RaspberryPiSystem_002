import { useCallback, useEffect, useRef, useState } from 'react';

import { disposeVoiceSession, startVoiceTranscription } from '../../voice/voiceTranscription';

import type { VoiceSession } from '../../voice/voiceTranscription';

export function useProcedureManualNameVoiceInput(value: string, onApply: (value: string) => void) {
  const [status, setStatus] = useState<'idle' | 'recording' | 'processing'>('idle');
  const [error, setError] = useState('');
  const [previousName, setPreviousName] = useState<string | null>(null);
  const sessionRef = useRef<VoiceSession | null>(null);

  const cancel = useCallback(() => {
    const session = sessionRef.current;
    sessionRef.current = null;
    if (session) disposeVoiceSession(session);
  }, []);
  useEffect(() => cancel, [cancel]);

  const reset = () => {
    cancel();
    setStatus('idle');
    setError('');
    setPreviousName(null);
  };
  const start = async () => {
    if (sessionRef.current) return;
    const session: VoiceSession = { abort: new AbortController() };
    sessionRef.current = session;
    const active = () => sessionRef.current === session && !session.abort.signal.aborted;
    const finish = () => {
      sessionRef.current = null;
      setStatus('idle');
    };
    setError('');
    setPreviousName(null);
    setStatus('recording');
    await startVoiceTranscription(session, active, () => setStatus('processing'), text => {
      const name = text.trim().replace(/[\s。、.]+$/u, '').slice(0, 200);
      if (name) {
        setPreviousName(value);
        onApply(name);
      } else {
        setError('聞き取れませんでした');
      }
      finish();
    }, message => {
      if (!active()) return;
      setError(message);
      finish();
    });
  };
  const stop = () => {
    const session = sessionRef.current;
    if (session?.recorder?.state === 'recording') session.recorder.stop();
    else if (session && !session.recorder) reset();
  };
  const restore = () => {
    if (previousName === null) return;
    onApply(previousName);
    setPreviousName(null);
  };

  return { status, error, canRestore: previousName !== null, start, stop, restore, reset };
}
