import { Fragment, useState } from 'react';

import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';

type Props = {
  title: string;
  note: string;
  summaryRows: { label: string; value: string }[];
  confirmLabel: string;
  busyLabel: string;
  busy: boolean;
  error: string | null;
  onConfirm: (accessPassword: string) => void;
  onCancel: () => void;
};

export function AssemblyAccessPasswordConfirmDialog({
  title, note, summaryRows, confirmLabel, busyLabel, busy, error, onConfirm, onCancel
}: Props) {
  const [accessPassword, setAccessPassword] = useState('');
  return (
    <div
      className="fixed inset-0 z-[1200] flex items-center justify-center bg-slate-950/85 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="assembly-access-password-confirm-heading"
    >
      <section className="grid w-full max-w-xl gap-4 rounded-xl border border-rose-300/35 bg-slate-900 p-5 text-white shadow-2xl">
        <div>
          <h2 id="assembly-access-password-confirm-heading" className="text-xl font-bold">{title}</h2>
          <p className="mt-2 text-sm font-semibold text-rose-100">
            {note}
          </p>
        </div>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 rounded border border-white/10 bg-slate-950/50 p-3 text-sm">
          {summaryRows.map(({ label, value }) => (
            <Fragment key={label}>
              <dt className="font-semibold text-white/55">{label}</dt><dd className="font-bold">{value}</dd>
            </Fragment>
          ))}
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
            disabled={busy || accessPassword.length === 0}
            onClick={() => onConfirm(accessPassword)}
          >
            {busy ? busyLabel : confirmLabel}
          </Button>
        </div>
      </section>
    </div>
  );
}
