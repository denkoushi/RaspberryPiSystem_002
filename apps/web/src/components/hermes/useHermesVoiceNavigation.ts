import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { resolveVoiceNavigation } from '../../features/voice/voiceNavigation';

import { useHermesHoldVoice } from './useHermesHoldVoice';

import type { HermesPanelMessage } from './HermesChatPanel';

export function useHermesVoiceNavigation(enabled: boolean, open: boolean, onDraft: (text: string) => void, onHoldDraft: () => void, onClose: () => void) {
  const navigate = useNavigate();
  const [voiceMessages, setVoiceMessages] = useState<HermesPanelMessage[]>([]);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(closeTimer.current), [open]);
  const holdVoice = useHermesHoldVoice(enabled, text => {
    const destination = resolveVoiceNavigation(text);
    if (destination) {
      navigate(destination.path);
      return true;
    }
    onHoldDraft();
    onDraft(text);
    return false;
  });
  const onPanelTranscript = (text: string) => {
    const destination = resolveVoiceNavigation(text);
    if (!destination) { onDraft(text); return; }
    setVoiceMessages(current => [...current,
      { id: crypto.randomUUID(), role: 'user', content: text, localOnly: true, voice: true },
      { id: crypto.randomUUID(), role: 'assistant', content: `${destination.label} を開きました。`, localOnly: true }
    ]);
    navigate(destination.path);
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(onClose, 900);
  };
  return { holdVoice, voiceMessages, setVoiceMessages, onPanelTranscript };
}
