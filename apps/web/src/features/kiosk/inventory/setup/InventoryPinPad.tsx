import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { useVerifyKioskDueManagementAccessPassword } from '../../../../api/hooks';
import { KioskDigitTenkey } from '../../KioskDigitTenkey';
import { LockIcon } from '../InventoryIcons';
import { invButtonGhost, invError, invKey, invKeyUtil, invPanel, invSurface } from '../inventoryUi';

const PIN_LENGTH = 4;

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
        setMessage('パスワードが違います');
        setDigits('');
        return;
      }
      onUnlocked(password);
    } catch {
      setMessage('確認できませんでした。ネットワークを確認してください');
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
    <div className={`${invSurface} items-center justify-center`}>
      <section className={`${invPanel} flex w-[460px] flex-col gap-5 p-8`} aria-label="在庫の準備を開く">
        <div className="text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-inv-s2 text-inv-cyan"><LockIcon size={26} /></div>
          <h1 className="text-[22px] font-black">在庫の準備</h1>
          <p className="mt-1 text-[13px] text-inv-faint">4桁のパスワード</p>
        </div>
        <div className="flex h-7 items-center justify-center gap-[18px]" aria-label={`${digits.length}桁入力済み`}>
          {Array.from({ length: PIN_LENGTH }, (_, index) => (
            <span key={index} className={index < digits.length ? 'h-[18px] w-[18px] rounded-full bg-inv-cyan' : 'h-[18px] w-[18px] rounded-full border-2 border-inv-line2'} />
          ))}
        </div>
        {message ? <p className={`rounded-xl border p-3 text-center text-base ${invError}`} role="alert">{message}</p> : null}
        <KioskDigitTenkey
          value={digits}
          onChange={change}
          maxLength={PIN_LENGTH}
          ariaLabel="パスワードのテンキー"
          className="grid grid-cols-3 gap-2.5 [&>button:nth-child(10)]:col-start-2"
          keyClassName={`${invKey} h-[76px] text-[30px]`}
          resetClassName={`${invKeyUtil} h-[76px]`}
          disabled={verify.isPending}
        />
        {verify.isPending ? <p className="text-center text-inv-muted">確認中…</p> : null}
        <Link to="/kiosk/inventory" className={invButtonGhost}>やめる</Link>
      </section>
    </div>
  );
}
