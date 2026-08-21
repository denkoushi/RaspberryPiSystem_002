import { useEffect, useRef } from 'react';

import { Button } from '../../../components/ui/Button';

type SelfInspectionRegistrationPolicyDialogProps = {
  open: boolean;
  requireMeasuringInstrumentTag: boolean;
  password: string;
  pending: boolean;
  message: string | null;
  onPasswordChange: (password: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
};

/**
 * Operation-time policy confirmation. Password is intentionally owned by the
 * page for one render cycle only and is cleared on every close/submit path.
 */
export function SelfInspectionRegistrationPolicyDialog({
  open,
  requireMeasuringInstrumentTag,
  password,
  pending,
  message,
  onPasswordChange,
  onCancel,
  onSubmit
}: SelfInspectionRegistrationPolicyDialogProps) {
  const passwordRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      passwordRef.current?.focus();
    }
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-slate-950/75 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onCancel();
      }}
    >
      <div
        className="w-full max-w-md rounded border border-white/20 bg-slate-900 p-5 text-white shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="self-inspection-policy-dialog-title"
        aria-describedby="self-inspection-policy-dialog-description"
      >
        <h2 id="self-inspection-policy-dialog-title" className="text-lg font-bold">
          使用前点検必須を変更
        </h2>
        <p id="self-inspection-policy-dialog-description" className="mt-2 text-sm text-white/70">
          {requireMeasuringInstrumentTag ? 'OFF' : 'ON'} に変更するには操作時パスワードが必要です。
          パスワードは保存されません。
        </p>
        <form
          className="mt-4 grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!pending) onSubmit();
          }}
        >
          <label className="grid gap-1 text-sm">
            <span>操作時パスワード</span>
            <input
              ref={passwordRef}
              type="password"
              autoComplete="off"
              value={password}
              onChange={(event) => onPasswordChange(event.target.value)}
              className="min-h-11 rounded border border-white/20 bg-slate-950 px-3 py-2 text-white"
              aria-label="操作時パスワード"
            />
          </label>
          {message ? (
            <p role="alert" className="rounded border border-amber-400/40 bg-amber-500/15 px-3 py-2 text-sm text-amber-100">
              {message}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghostOnDark" disabled={pending} onClick={onCancel}>
              キャンセル
            </Button>
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? '変更中...' : '変更する'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
