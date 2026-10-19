import { useRef, useState } from 'react';

import { KioskKeyboardModal } from '../../../components/kiosk/KioskKeyboardModal';
import { useSingleFlight } from '../../../hooks/useSingleFlight';

import { useSeibanVoiceInput } from './useSeibanVoiceInput';

import type { ReactNode } from 'react';

export type SeibanSearchRegisterProps = {
  value: string;
  onChange: (value: string) => void;
  onRegister: (value: string) => void | Promise<boolean | void>;
  inputPlaceholder: string;
  inputAriaLabel?: string;
  inputType?: 'text' | 'search';
  inputDisabled?: boolean;
  onInputFocus?: () => void;
  showKeyboardButton?: boolean;
  showVoiceButton?: boolean;
  registerDisabled?: boolean;
  clearOnSuccess?: boolean;
  onClearError?: () => void;
  error?: ReactNode;
  inputClassName: string;
  keyboardButtonClassName: string;
  registerButtonClassName: string;
};

export function SeibanSearchRegister({
  value,
  onChange,
  onRegister,
  inputPlaceholder,
  inputAriaLabel = '製番を検索',
  inputType = 'text',
  inputDisabled = false,
  onInputFocus,
  showKeyboardButton = true,
  showVoiceButton = false,
  registerDisabled = false,
  clearOnSuccess = false,
  onClearError,
  error,
  inputClassName,
  keyboardButtonClassName,
  registerButtonClassName
}: SeibanSearchRegisterProps) {
  const { run, pending } = useSingleFlight();
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [keyboardValue, setKeyboardValue] = useState('');
  const currentValueRef = useRef(value);
  currentValueRef.current = value;
  const voice = useSeibanVoiceInput(value, showVoiceButton && !inputDisabled, (seiban) => {
    onInputFocus?.();
    onChange(seiban);
    onClearError?.();
  });

  const register = () => {
    const trimmed = value.trim();
    if (!trimmed || registerDisabled) return;
    void run(async () => {
      const saved = await onRegister(trimmed);
      if (clearOnSuccess && saved !== false && currentValueRef.current === trimmed) onChange('');
    });
  };

  return (
    <>
      <div className="flex min-w-0 shrink-0 gap-1.5">
        <input
          type={inputType}
          onFocus={onInputFocus}
          value={value}
          disabled={inputDisabled}
          onChange={(event) => {
            voice.manualEdit();
            onChange(event.target.value);
            onClearError?.();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              register();
            }
          }}
          placeholder={inputPlaceholder}
          aria-label={inputAriaLabel}
          className={inputClassName}
        />
        {showKeyboardButton ? <button
          type="button"
          onClick={() => {
            setKeyboardValue(value);
            setKeyboardOpen(true);
          }}
          disabled={inputDisabled}
          className={keyboardButtonClassName}
          aria-label="キーボードを開く"
        >
          ⌨
        </button> : null}
        {showVoiceButton ? <button
          type="button"
          onClick={() => {
            if (voice.status === 'recording') voice.stop();
            else { onInputFocus?.(); void voice.start(); }
          }}
          disabled={inputDisabled || voice.status === 'processing'}
          aria-label={voice.status === 'recording' ? '止める' : '音声で入力'}
          aria-pressed={voice.status === 'recording'}
          aria-busy={voice.status === 'processing'}
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-md border focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300 disabled:opacity-40 ${voice.status === 'recording' ? 'border-red-400 bg-red-600 text-white' : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-emerald-300 hover:text-white'}`}
        >
          {voice.status === 'processing' ? <span aria-hidden="true" className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" />
            : voice.status === 'recording' ? <span aria-hidden="true" className="h-4 w-4 rounded-sm bg-current" />
              : <svg aria-hidden="true" className="h-[26px] w-[26px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>}
        </button> : null}
        <button
          type="button"
          onClick={register}
          disabled={registerDisabled || pending}
          aria-busy={pending}
          className={registerButtonClassName}
        >
          登録
        </button>
      </div>
      {voice.error ? <div role="status" className="mt-1 text-xs text-rose-300">{voice.error}</div> : null}
      {error}
      <KioskKeyboardModal
        isOpen={keyboardOpen}
        value={keyboardValue}
        onChange={setKeyboardValue}
        onCancel={() => setKeyboardOpen(false)}
        onConfirm={() => {
          voice.manualEdit();
          onChange(keyboardValue);
          setKeyboardOpen(false);
        }}
      />
    </>
  );
}
