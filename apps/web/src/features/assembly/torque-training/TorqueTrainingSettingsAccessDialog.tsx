import { useEffect, useRef, useState } from 'react';

import { Button } from '../../../components/ui/Button';
import { Dialog } from '../../../components/ui/Dialog';

type Props = {
  open: boolean;
  busy: boolean;
  error: string | null;
  onSubmit: (accessPassword: string) => void | Promise<void>;
  onCancel: () => void;
};

/**
 * Kiosk operation-password gate for torque-training settings.
 *
 * The input is local component state and is cleared before the request is
 * awaited. The controller retains the password only in React memory after a
 * successful snapshot request so each subsequent mutation can be rechecked
 * by the server.
 */
export function TorqueTrainingSettingsAccessDialog({
  open,
  busy,
  error,
  onSubmit,
  onCancel
}: Props) {
  const passwordRef = useRef<HTMLInputElement | null>(null);
  const [password, setPassword] = useState('');

  useEffect(() => {
    if (!open) setPassword('');
  }, [open]);

  if (!open) return null;

  const submit = () => {
    if (password.length !== 4) return;
    const submittedPassword = password;
    setPassword('');
    void onSubmit(submittedPassword);
  };

  return (
    <Dialog
      isOpen={open}
      onClose={onCancel}
      title="訓練設定の認証"
      description="自主検査と同じ4桁の操作時パスワードを入力してください。パスワードは保存されません。"
      closeOnEsc={!busy}
      closeOnBackdrop={!busy}
      initialFocusRef={passwordRef}
      size="sm"
      overlayZIndex={90}
      className="!my-auto !rounded !border !border-white/20 !bg-slate-900 !p-5 !text-white !shadow-2xl [&>p]:!text-white/70"
      titleClassName="text-lg font-bold"
    >
      <form
        className="mt-4 grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) submit();
        }}
      >
        <label className="grid gap-1 text-sm font-semibold" htmlFor="torque-training-settings-access-password">
          <span>操作時パスワード</span>
          <input
            ref={passwordRef}
            id="torque-training-settings-access-password"
            type="password"
            inputMode="numeric"
            pattern="[0-9]{4}"
            maxLength={4}
            autoComplete="off"
            value={password}
            disabled={busy}
            onChange={(event) => setPassword(event.target.value.replace(/\D/g, '').slice(0, 4))}
            className="min-h-11 rounded border border-white/20 bg-slate-950 px-3 py-2 text-white"
            aria-label="操作時パスワード"
          />
        </label>
        {error ? (
          <p role="alert" className="rounded border border-amber-400/40 bg-amber-500/15 px-3 py-2 text-sm text-amber-100">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghostOnDark" disabled={busy} onClick={onCancel}>
            閉じる
          </Button>
          <Button type="submit" variant="primary" disabled={busy || password.length !== 4}>
            {busy ? '認証中...' : '認証する'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
