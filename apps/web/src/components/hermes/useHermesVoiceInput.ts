import { useCallback, useEffect, useRef, useState } from 'react';

import { disposeVoiceSession, startVoiceTranscription, type VoiceInputError, type VoiceSession } from '../../features/voice/voiceTranscription';

// Both Hermes entry points share one microphone, including while permission or STT is pending.
let activeSession: VoiceSession | null = null;

export function useHermesVoiceInput(enabled: boolean, onTranscript: (text: string) => void) {
  const sessionRef = useRef<VoiceSession | null>(null);
  const [state, setState] = useState<'idle' | 'preparing' | 'recording' | 'processing'>('idle');
  const [error, setError] = useState<VoiceInputError | null>(null);
  const [meter, setMeter] = useState({ level: 0, seconds: 0, microphone: '' });
  const cancel = useCallback(() => {
    const session = sessionRef.current;
    sessionRef.current = null;
    if (session) {
      if (activeSession === session) activeSession = null;
      disposeVoiceSession(session);
    }
    setState('idle');
  }, []);
  useEffect(() => cancel, [cancel]);
  useEffect(() => { if (!enabled) cancel(); }, [enabled, cancel]);

  const stop = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    // A release before permission arrives must never leave a recorder running later.
    if (!session.recorder) cancel();
    else if (session.recorder.state === 'recording') session.recorder.stop();
  }, [cancel]);

  const start = useCallback(() => {
    if (!enabled || activeSession) return;
    const session: VoiceSession = { abort: new AbortController() };
    sessionRef.current = session;
    activeSession = session;
    setError(null);
    setMeter({ level: 0, seconds: 0, microphone: '' });
    setState('preparing');
    const active = () => sessionRef.current === session && !session.abort.signal.aborted;
    void startVoiceTranscription(session, active, () => setState('processing'), text => {
      cancel();
      onTranscript(text);
    }, message => {
      if (!active()) return;
      cancel();
      setError(message);
    }, 'kiosk-navigation', {
      silenceStopMs: 1200,
      onRecording: microphone => {
        if (!active()) return;
        setState('recording');
        setMeter(current => ({ ...current, microphone }));
      },
      onLevel: (level, seconds) => setMeter(current => ({ ...current, level, seconds }))
    });
  }, [enabled, onTranscript, cancel]);
  const toggle = () => { if (sessionRef.current) stop(); else start(); };
  return { state, error, meter, toggle, start, stop, cancel };
}
