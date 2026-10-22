import { useEffect, useRef, useState } from 'react';

import { disposeVoiceSession, startVoiceTranscription } from '../../voice/voiceTranscription';

import type { VoiceSession } from '../../voice/voiceTranscription';

export function useHaizenVoiceSearch(onTranscript: (text: string) => void) {
  const [status, setStatus] = useState<'idle' | 'recording' | 'processing'>('idle');
  const [error, setError] = useState('');
  const sessionRef = useRef<VoiceSession | null>(null);
  const latest = useRef(onTranscript);
  latest.current = onTranscript;
  const cancel = () => {
    if (sessionRef.current) disposeVoiceSession(sessionRef.current);
    sessionRef.current = null;
  };
  useEffect(() => cancel, []);
  const start = async () => {
    if (sessionRef.current) return;
    const session: VoiceSession = { abort: new AbortController() };
    sessionRef.current = session;
    const active = () => sessionRef.current === session && !session.abort.signal.aborted;
    const finish = () => { cancel(); setStatus('idle'); };
    setError(''); setStatus('recording');
    await startVoiceTranscription(session, active, () => setStatus('processing'), text => {
      if (!active()) return;
      latest.current(text); finish();
    }, message => {
      if (!active()) return;
      setError(message); finish();
    });
  };
  const stop = () => {
    if (sessionRef.current?.recorder?.state === 'recording') sessionRef.current.recorder.stop();
    else { cancel(); setStatus('idle'); }
  };
  return { status, error, start, stop };
}
