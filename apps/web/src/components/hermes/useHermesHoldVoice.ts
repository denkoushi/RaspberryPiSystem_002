import { useCallback, useEffect, useRef, useState } from 'react';

import { useHermesVoiceInput } from './useHermesVoiceInput';

export function useHermesHoldVoice(enabled: boolean, onTranscript: (text: string) => boolean) {
  const [feedback, setFeedback] = useState<'success' | 'error' | null>(null);
  const voice = useHermesVoiceInput(enabled, text => setFeedback(onTranscript(text) ? 'success' : null), 0);
  const cancelVoice = voice.cancel;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const held = useRef(false);
  const ownsRecording = useRef(false);
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => {
    if (voice.error) setFeedback('error');
  }, [voice.error]);
  useEffect(() => {
    if (!feedback) return;
    const timeout = setTimeout(() => setFeedback(null), feedback === 'success' ? 700 : 900);
    return () => clearTimeout(timeout);
  }, [feedback]);
  const cancel = useCallback(() => {
    clearTimeout(timer.current);
    clearTimeout(stopTimer.current);
    stopTimer.current = undefined;
    ownsRecording.current = false;
    setConfirmed(false);
    cancelVoice();
    setFeedback(null);
  }, [cancelVoice]);
  useEffect(() => () => {
    clearTimeout(timer.current);
    clearTimeout(stopTimer.current);
  }, []);
  useEffect(() => {
    if (!enabled) cancel();
    const onBlur = () => cancel();
    window.addEventListener('blur', onBlur);
    return () => window.removeEventListener('blur', onBlur);
  }, [enabled, cancel]);
  const press = () => {
    clearTimeout(timer.current);
    if (stopTimer.current !== undefined) {
      clearTimeout(stopTimer.current);
      stopTimer.current = undefined;
      voice.stop();
    }
    held.current = false;
    setConfirmed(false);
    setFeedback(null);
    ownsRecording.current = voice.start();
    timer.current = setTimeout(() => {
      held.current = true;
      setConfirmed(true);
    }, 400);
  };
  const release = () => {
    clearTimeout(timer.current);
    if (ownsRecording.current) {
      if (held.current) {
        stopTimer.current = setTimeout(() => {
          stopTimer.current = undefined;
          voice.stop();
        }, 350);
      } else cancel();
    }
    return held.current;
  };
  return { press, release, cancel, state: voice.state === 'preparing' || (voice.state === 'recording' && !confirmed) ? null : voice.state === 'idle' ? feedback : voice.state, level: voice.meter.level };
}
