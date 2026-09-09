import { useRef, useState } from 'react';

import { KioskKeyboardModal } from '../../../components/kiosk/KioskKeyboardModal';

import type { ReactNode } from 'react';

export type SeibanSearchRegisterProps = {
  value: string;
  onChange: (value: string) => void;
  onRegister: (value: string) => void | Promise<boolean | void>;
  inputPlaceholder: string;
  inputAriaLabel?: string;
  inputType?: 'text' | 'search';
  inputDisabled?: boolean;
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
  registerDisabled = false,
  clearOnSuccess = false,
  onClearError,
  error,
  inputClassName,
  keyboardButtonClassName,
  registerButtonClassName
}: SeibanSearchRegisterProps) {
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [keyboardValue, setKeyboardValue] = useState('');
  const currentValueRef = useRef(value);
  currentValueRef.current = value;

  const register = () => {
    const trimmed = value.trim();
    if (!trimmed || registerDisabled) return;
    const result = onRegister(trimmed);
    if (result && typeof result.then === 'function') {
      void result.then((saved) => {
        if (clearOnSuccess && saved !== false && currentValueRef.current === trimmed) onChange('');
      });
    } else if (clearOnSuccess) {
      onChange('');
    }
  };

  return (
    <>
      <div className="flex shrink-0 gap-1.5">
        <input
          type={inputType}
          value={value}
          disabled={inputDisabled}
          onChange={(event) => {
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
        <button
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
        </button>
        <button
          type="button"
          onClick={register}
          disabled={registerDisabled}
          className={registerButtonClassName}
        >
          登録
        </button>
      </div>
      {error}
      <KioskKeyboardModal
        isOpen={keyboardOpen}
        value={keyboardValue}
        onChange={setKeyboardValue}
        onCancel={() => setKeyboardOpen(false)}
        onConfirm={() => {
          onChange(keyboardValue);
          setKeyboardOpen(false);
        }}
      />
    </>
  );
}
