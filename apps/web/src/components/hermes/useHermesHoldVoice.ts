import { useCallback, useEffect, useRef, useState } from 'react';

import { useHermesVoiceInput } from './useHermesVoiceInput';

export function useHermesHoldVoice(enabled: boolean, onTranscript: (text: string) => boolean) {
  const [feedback, setFeedback] = useState<'success' | 'error' | null>(null);
  const voice = useHermesVoiceInput(enabled, text => setFeedback(onTranscript(text) ? 'success' : null));
  const cancelVoice = voice.cancel;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const held = useRef(false);
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
    cancelVoice();
    setFeedback(null);
  }, [cancelVoice]);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!enabled) cancel();
    const onBlur = () => cancel();
    window.addEventListener('blur', onBlur);
    return () => window.removeEventListener('blur', onBlur);
  }, [enabled, cancel]);
  const press = () => {
    clearTimeout(timer.current);
    held.current = false;
    timer.current = setTimeout(() => {
      held.current = true;
      setFeedback(null);
      voice.start();
    }, 400);
  };
  const release = () => {
    clearTimeout(timer.current);
    if (held.current) voice.stop();
    return held.current;
  };
  return { press, release, cancel, state: voice.state === 'idle' ? feedback : voice.state, level: voice.meter.level };
}
