import { useEffect, useState } from 'react';

import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';

export type AssemblyWorkUnitInvalidationTarget = {
  workUnitId: string;
  productNo: string;
  workId: string;
  stateLabel: string;
};

type Props = {
  target: AssemblyWorkUnitInvalidationTarget | null;
  busy: boolean;
  error: string | null;
  onConfirm: (input: { accessPassword: string; reason: string }) => void;
  onCancel: () => void;
};

export function AssemblyWorkUnitInvalidationDialog({
  target,
  busy,
  error,
  onConfirm,
  onCancel
}: Props) {
  const [accessPassword, setAccessPassword] = useState('');
  const [reason, setReason] = useState('');

  useEffect(() => {
    setAccessPassword('');
    setReason('');
  }, [target?.workUnitId]);

  if (!target) return null;
  const canSubmit = accessPassword.length > 0 && reason.trim().length > 0 && reason.trim().length <= 500;

  return (
    <div
      className="fixed inset-0 z-[1200] flex items-center justify-center bg-slate-950/85 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="assembly-invalidation-heading"
    >
      <section className="grid w-full max-w-xl gap-4 rounded-xl border border-rose-300/35 bg-slate-900 p-5 text-white shadow-2xl">
        <div>
          <h2 id="assembly-invalidation-heading" className="text-xl font-bold">作業アイテムを削除</h2>
          <p className="mt-2 text-sm font-semibold text-rose-100">
            一覧から除外します。作業用IDは再利用できず、この操作は元に戻せません。
          </p>
        </div>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 rounded border border-white/10 bg-slate-950/50 p-3 text-sm">
          <dt className="font-semibold text-white/55">製番</dt><dd className="font-bold">{target.productNo}</dd>
          <dt className="font-semibold text-white/55">作業用ID</dt><dd className="font-bold">{target.workId}</dd>
          <dt className="font-semibold text-white/55">現在状態</dt><dd className="font-bold">{target.stateLabel}</dd>
        </dl>
        <label className="grid gap-1 text-sm font-semibold text-white/75">
          管理パスワード
          <Input
            type="password"
            value={accessPassword}
            onChange={(event) => setAccessPassword(event.target.value)}
            autoComplete="off"
            disabled={busy}
          />
        </label>
        <label className="grid gap-1 text-sm font-semibold text-white/75">
          削除理由（必須・500文字以内）
          <textarea
            className="min-h-28 rounded border border-white/15 bg-slate-950 px-3 py-2 text-white"
            value={reason}
            maxLength={500}
            onChange={(event) => setReason(event.target.value)}
            disabled={busy}
          />
        </label>
        {error ? (
          <p className="rounded border border-rose-300/30 bg-rose-500/10 px-3 py-2 text-sm font-semibold text-rose-100" role="alert">
            {error}
          </p>
        ) : null}
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="secondary" disabled={busy} onClick={onCancel}>キャンセル</Button>
          <Button
            type="button"
            variant="danger"
            disabled={busy || !canSubmit}
            onClick={() => onConfirm({ accessPassword, reason: reason.trim() })}
          >
            {busy ? '削除中…' : '削除する'}
          </Button>
        </div>
      </section>
    </div>
  );
}
