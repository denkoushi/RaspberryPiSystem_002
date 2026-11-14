import { useEffect, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';

import type { useHermesVoiceInput } from './useHermesVoiceInput';

export function VoiceMicrophoneIcon() {
  return <svg className="hermes-chat-panel__voice-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><rect x="8" y="2" width="8" height="13" rx="4" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" /></svg>;
}

type HermesVoiceControlsProps = {
  panelRef: RefObject<HTMLElement | null>;
  voice: ReturnType<typeof useHermesVoiceInput>;
  disabled: boolean;
};

// The mic button and the recording meter are placed inside chatscope's MessageInput via portals.
export function HermesVoiceControls({ panelRef, voice, disabled }: HermesVoiceControlsProps) {
  const [voiceTools, setVoiceTools] = useState<Element | null>(null);
  const [voiceEditor, setVoiceEditor] = useState<Element | null>(null);
  // MessageInput may remount on any parent render, so look up its DOM after every render.
  // Runs after commit so the panel ref is attached. Setting the same element again is a no-op, so this does not loop.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setVoiceTools(panelRef.current?.querySelector('.cs-message-input__tools') ?? null);
    setVoiceEditor(panelRef.current?.querySelector('.cs-message-input__content-editor-wrapper') ?? null);
  });
  return <>
    {voiceTools ? createPortal(
      <button type="button" className={`cs-button hermes-chat-panel__voice${voice.state === 'recording' ? ' hermes-chat-panel__voice--recording' : ''}`}
        aria-label={voice.state === 'recording' || voice.state === 'preparing' ? '聞き取りを止める' : voice.state === 'processing' ? '文字にしています' : '声で入力'}
        disabled={voice.state === 'processing' || (voice.state === 'idle' && disabled)}
        onClick={voice.toggle}>
        {voice.state === 'recording' ? <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="5" width="14" height="14" fill="currentColor" /></svg>
          : voice.state === 'processing' ? <svg className="hermes-chat-panel__voice-spinner" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="36 16" /></svg>
          : <VoiceMicrophoneIcon />}
      </button>, voiceTools) : null}
    {voice.state === 'recording' && voiceEditor ? createPortal(
      <div className="hermes-chat-panel__recording">
        <span className="hermes-chat-panel__voice-bars" aria-hidden="true">{[0.45, 0.7, 0.9, 1, 0.8, 0.6, 0.4].map((scale, index) => <i key={index} style={{ transform: `scaleY(${0.12 + voice.meter.level * scale * 0.88})` }} />)}</span>
        <span>{voice.meter.seconds}秒</span>
        {voice.meter.microphone ? <span className="hermes-chat-panel__microphone-name">{voice.meter.microphone}</span> : null}
      </div>, voiceEditor) : null}
  </>;
}
