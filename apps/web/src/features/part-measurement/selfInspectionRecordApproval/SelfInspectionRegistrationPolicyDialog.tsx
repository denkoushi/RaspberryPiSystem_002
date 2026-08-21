import { useRef } from 'react';

import { Button } from '../../../components/ui/Button';
import { Dialog } from '../../../components/ui/Dialog';

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

  return (
    <Dialog
      isOpen={open}
      onClose={onCancel}
      title="使用前点検必須を変更"
      description={`${requireMeasuringInstrumentTag ? 'OFF' : 'ON'} に変更するには操作時パスワードが必要です。パスワードは保存されません。`}
      closeOnEsc={!pending}
      closeOnBackdrop={!pending}
      initialFocusRef={passwordRef}
      size="md"
      className="!my-auto !rounded !border !border-white/20 !bg-slate-900 !p-5 !text-white !shadow-2xl [&>p]:!text-white/70"
      titleClassName="text-lg font-bold"
    >
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
    </Dialog>
  );
}
