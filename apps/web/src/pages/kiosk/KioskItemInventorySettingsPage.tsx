import { useCallback, useEffect, useRef, useState } from 'react';

import { useVerifyKioskDueManagementAccessPassword } from '../../api/hooks';
import { RaspiInventoryPage } from '../admin/RaspiInventoryPage';

export function KioskItemInventorySettingsPage() {
  const verifyMutation = useVerifyKioskDueManagementAccessPassword();
  const [accessPassword, setAccessPassword] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const promptShownRef = useRef(false);

  const requestAccessPassword = useCallback(async () => {
    const password = typeof window !== 'undefined' ? window.prompt('在庫設定の操作パスワードを入力してください') : null;
    if (!password) {
      setMessage('在庫設定の操作には4桁の操作パスワードが必要です。');
      return;
    }
    if (!/^\d{4}$/.test(password.trim())) {
      setMessage('操作パスワードは4桁の数字で入力してください。');
      return;
    }
    setMessage(null);
    try {
      const result = await verifyMutation.mutateAsync({ password: password.trim() });
      if (!result.success) {
        setMessage('パスワードが違います。');
        return;
      }
      setAccessPassword(password.trim());
    } catch {
      setMessage('認証に失敗しました。ネットワーク接続を確認してください。');
    }
  }, [verifyMutation]);

  useEffect(() => {
    if (accessPassword || promptShownRef.current) return;
    promptShownRef.current = true;
    void requestAccessPassword();
  }, [accessPassword, requestAccessPassword]);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(null), 4000);
    return () => window.clearTimeout(timer);
  }, [message]);

  if (accessPassword) {
    return <RaspiInventoryPage accessPassword={accessPassword} />;
  }

  return (
    <section className="mx-auto flex w-full max-w-md flex-col gap-4 rounded-lg border border-white/15 bg-slate-900/60 p-6">
      <div>
        <h1 className="text-2xl font-bold">在庫設定</h1>
        <p className="mt-2 text-sm text-white/70">在庫の登録・保管場所・NFC設定を開くには、操作パスワードを入力してください。</p>
      </div>
      {message ? <p className="rounded border border-red-400/50 bg-red-950/60 p-3 text-sm text-red-100" role="alert">{message}</p> : null}
      <button type="button" className="min-h-10 rounded-md bg-sky-600 px-4 font-semibold text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40" onClick={() => void requestAccessPassword()} disabled={verifyMutation.isPending}>
        {verifyMutation.isPending ? '認証中…' : '認証する'}
      </button>
    </section>
  );
}
