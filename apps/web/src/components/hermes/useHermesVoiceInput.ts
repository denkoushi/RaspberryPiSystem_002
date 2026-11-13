import { useEffect, useRef, useState } from 'react';

import { disposeVoiceSession, startVoiceTranscription, type VoiceInputError, type VoiceSession } from '../../features/voice/voiceTranscription';

export function useHermesVoiceInput(enabled: boolean, onTranscript: (text: string) => void) {
  const sessionRef = useRef<VoiceSession | null>(null);
  const [state, setState] = useState<'idle' | 'recording' | 'processing'>('idle');
  const [error, setError] = useState<VoiceInputError | null>(null);
  const [meter, setMeter] = useState({ level: 0, seconds: 0, microphone: '' });
  useEffect(() => () => {
    const session = sessionRef.current;
    sessionRef.current = null;
    if (session) disposeVoiceSession(session);
  }, []);
  useEffect(() => {
    if (enabled) return;
    const session = sessionRef.current;
    sessionRef.current = null;
    if (session) disposeVoiceSession(session);
    setState('idle');
  }, [enabled]);

  const toggle = () => {
    if (sessionRef.current) {
      if (!sessionRef.current.recorder) {
        const session = sessionRef.current;
        sessionRef.current = null;
        disposeVoiceSession(session);
        setState('idle');
      } else if (sessionRef.current.recorder.state === 'recording') sessionRef.current.recorder.stop();
      return;
    }
    if (!enabled) return;
    const session: VoiceSession = { abort: new AbortController() };
    sessionRef.current = session;
    setError(null);
    setMeter({ level: 0, seconds: 0, microphone: '' });
    setState('recording');
    const active = () => sessionRef.current === session && !session.abort.signal.aborted;
    const finish = () => {
      sessionRef.current = null;
      disposeVoiceSession(session);
      setState('idle');
    };
    void startVoiceTranscription(session, active, () => setState('processing'), text => {
      finish();
      onTranscript(text);
    }, message => {
      if (!active()) return;
      finish();
      setError(message);
    }, undefined, {
      silenceStopMs: 1200,
      onRecording: microphone => setMeter(current => ({ ...current, microphone })),
      onLevel: (level, seconds) => setMeter(current => ({ ...current, level, seconds }))
    });
  };
  return { state, error, meter, toggle };
}
