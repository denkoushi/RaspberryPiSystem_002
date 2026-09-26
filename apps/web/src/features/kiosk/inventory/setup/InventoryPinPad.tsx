import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { useVerifyKioskDueManagementAccessPassword } from '../../../../api/hooks';
import { KioskDigitTenkey } from '../../KioskDigitTenkey';
import { kioskButtonSecondaryClassName, kioskPanelClassName } from '../../kioskTheme';

const PIN_LENGTH = 4;
const keyClassName =
  'inline-flex h-16 items-center justify-center rounded-lg border border-white/15 bg-slate-950 text-3xl font-bold text-white hover:bg-slate-800 disabled:opacity-40';
const resetClassName =
  'inline-flex h-16 items-center justify-center rounded-lg border border-amber-300/30 bg-slate-950 text-lg font-bold text-amber-200 hover:bg-slate-800 disabled:opacity-40';

/** On-screen 4-digit unlock for inventory setup; the verified PIN is handed to the setup screen. */
export function InventoryPinPad({ onUnlocked }: { onUnlocked: (password: string) => void }) {
  const verify = useVerifyKioskDueManagementAccessPassword();
  const [digits, setDigits] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(null), 4000);
    return () => window.clearTimeout(timer);
  }, [message]);

  const submit = async (password: string) => {
    try {
      const result = await verify.mutateAsync({ password });
      if (!result.success) {
        setMessage('パスワードが違います。');
        setDigits('');
        return;
      }
      onUnlocked(password);
    } catch {
      setMessage('認証に失敗しました。ネットワーク接続を確認してください。');
      setDigits('');
    }
  };

  const change = (next: string) => {
    if (verify.isPending) return;
    const value = next.slice(0, PIN_LENGTH);
    setDigits(value);
    if (value.length === PIN_LENGTH) void submit(value);
  };

  return (
    <section className={`${kioskPanelClassName} mx-auto flex w-full max-w-md flex-col gap-4 p-6`} aria-label="在庫の準備を開く">
      <div>
        <h1 className="text-2xl font-bold text-white">在庫の準備</h1>
        <p className="mt-1 text-base text-white/70">開くには4桁のパスワードを入れてください</p>
      </div>
      <div className="flex justify-center gap-4 py-2" aria-label={`${digits.length}桁入力済み`}>
        {Array.from({ length: PIN_LENGTH }, (_, index) => (
          <span key={index} className={index < digits.length ? 'h-5 w-5 rounded-full bg-sky-400' : 'h-5 w-5 rounded-full border-2 border-white/40'} />
        ))}
      </div>
      {message ? <p className="rounded border border-red-400/50 bg-red-950/60 p-3 text-base text-red-100" role="alert">{message}</p> : null}
      <KioskDigitTenkey
        value={digits}
        onChange={change}
        maxLength={PIN_LENGTH}
        ariaLabel="パスワードのテンキー"
        className="grid grid-cols-3 gap-2"
        keyClassName={keyClassName}
        resetClassName={resetClassName}
        disabled={verify.isPending}
      />
      {verify.isPending ? <p className="text-center text-white/70">確認中…</p> : null}
      <Link to="/kiosk/inventory" className={`${kioskButtonSecondaryClassName} inline-flex min-h-12 items-center justify-center text-lg`}>やめる（在庫操作に戻る）</Link>
      <p className="text-center text-sm text-white/60">在庫操作の画面に戻ると、またロックされます</p>
    </section>
  );
}
