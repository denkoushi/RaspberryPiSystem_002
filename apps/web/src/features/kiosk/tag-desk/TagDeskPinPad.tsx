import { useEffect, useState } from 'react';

import { verifyTagDeskPin } from '../../../api/domains/tag-desk';
import { KioskDigitTenkey } from '../KioskDigitTenkey';

import { LockIcon } from './TagDeskIcons';
import { tagDesk } from './tagDeskTheme';

const PIN_LENGTH = 4;

/** On-screen 4-digit unlock (same password as due management and inventory setup). */
export function TagDeskPinPad({ onUnlocked }: { onUnlocked: (pin: string) => void }) {
  const [digits, setDigits] = useState('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(null), 4000);
    return () => window.clearTimeout(timer);
  }, [message]);

  const submit = async (pin: string) => {
    setPending(true);
    try {
      const result = await verifyTagDeskPin(pin);
      if (result.success) {
        onUnlocked(pin);
        return;
      }
      setMessage('パスワードが違います');
    } catch {
      setMessage('確認できませんでした。通信を確認してください');
    } finally {
      setPending(false);
      setDigits('');
    }
  };

  const change = (next: string) => {
    if (pending) return;
    const value = next.slice(0, PIN_LENGTH);
    setDigits(value);
    if (value.length === PIN_LENGTH) void submit(value);
  };

  return (
    <div className={`flex min-h-0 flex-1 items-center justify-center ${tagDesk.ink}`}>
      <section className={`flex w-[400px] flex-col gap-5 rounded-2xl border p-7 shadow-2xl ${tagDesk.slab} ${tagDesk.line}`} aria-label="タグ管理を開く">
        <h1 className="flex items-center gap-3 text-2xl font-black text-white">
          <LockIcon className="h-6 w-6 text-[#ffb547]" />
          タグ管理
        </h1>
        <div className="flex justify-center gap-4 py-1" aria-label={`${digits.length}桁入力済み`}>
          {Array.from({ length: PIN_LENGTH }, (_, index) => (
            <span
              key={index}
              className={index < digits.length ? 'h-[18px] w-[18px] rounded-full bg-[#4cc9f0]' : 'h-[18px] w-[18px] rounded-full border-2 border-[#3a4b62]'}
            />
          ))}
        </div>
        {message ? (
          <p className="rounded-lg border border-[#6b2a2d] bg-[#3a1719] px-3 py-2 text-base font-bold text-[#ff8a8a]" role="alert">{message}</p>
        ) : null}
        <KioskDigitTenkey
          value={digits}
          onChange={change}
          maxLength={PIN_LENGTH}
          ariaLabel="パスワードのテンキー"
          className="grid grid-cols-3 gap-2"
          keyClassName="inline-flex h-16 items-center justify-center rounded-xl border border-[#223043] bg-[#070b12] font-mono text-3xl text-white hover:bg-[#131c29] disabled:opacity-40"
          resetClassName="inline-flex h-16 items-center justify-center rounded-xl border border-[#223043] bg-[#070b12] text-base text-[#8494a8] hover:bg-[#131c29] disabled:opacity-40"
          disabled={pending}
        />
      </section>
    </div>
  );
}
