import { FormEvent, useEffect, useState } from 'react';

import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';

import type { SelfInspectionTableRow } from './selfInspectionTableModel';

function createRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ??
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
      const value = Math.floor(Math.random() * 16);
      const digit = character === 'x' ? value : (value & 0x3) | 0x8;
      return digit.toString(16);
    });
}

type Props = {
  row: SelfInspectionTableRow | null;
  isSubmitting: boolean;
  errorMessage: string | null;
  onClose: () => void;
  onConfirm: (input: {
    row: SelfInspectionTableRow;
    accessPassword: string;
    reason: string;
    requestId: string;
  }) => Promise<void>;
};

export function SelfInspectionItemInvalidationDialog({
  row,
  isSubmitting,
  errorMessage,
  onClose,
  onConfirm
}: Props) {
  const [accessPassword, setAccessPassword] = useState('');
  const [reason, setReason] = useState('');
  const [requestId, setRequestId] = useState(createRequestId);

  useEffect(() => {
    if (!row) return;
    setAccessPassword('');
    setReason('');
    setRequestId(createRequestId());
  }, [row]);

  const normalizedReason = reason.trim();
  const canSubmit =
    Boolean(row) &&
    accessPassword.length > 0 &&
    normalizedReason.length > 0 &&
    normalizedReason.length <= 500 &&
    !isSubmitting;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!row || !canSubmit) return;
    void onConfirm({
      row,
      accessPassword,
      reason: normalizedReason,
      requestId
    });
  };

  return (
    <Dialog
      isOpen={row != null}
      onClose={isSubmitting ? () => undefined : onClose}
      closeOnBackdrop={!isSubmitting}
      closeOnEsc={!isSubmitting}
      title="自主検査アイテムを削除"
      size="md"
      overlayZIndex={100}
      className="!border-rose-300/40 !bg-slate-900 !text-white"
      titleClassName="text-lg font-bold text-rose-100"
    >
      {row ? (
        <form className="mt-3 space-y-4" onSubmit={handleSubmit}>
          <div className="rounded border border-white/15 bg-slate-950/60 p-3 text-sm">
            <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-2 gap-y-1">
              <dt className="text-white/55">製造order</dt>
              <dd className="truncate font-mono font-bold">{row.productNo || '—'}</dd>
              <dt className="text-white/55">資源CD</dt>
              <dd className="font-mono font-bold">{row.resourceCd || '—'}</dd>
              <dt className="text-white/55">現在状態</dt>
              <dd className="font-semibold">{row.statusLabel}</dd>
            </dl>
          </div>

          <p className="rounded border border-rose-300/40 bg-rose-500/15 px-3 py-2 text-sm font-semibold text-rose-100">
            この操作は取り消せません。削除後は同じアイテムの再開始と紙帳票の再発行ができません。
          </p>

          <label className="grid gap-1 text-sm">
            <span className="font-semibold text-white/75">管理パスワード</span>
            <input
              type="password"
              autoComplete="off"
              value={accessPassword}
              disabled={isSubmitting}
              onChange={(event) => setAccessPassword(event.target.value)}
              className="min-h-11 rounded border border-white/20 bg-slate-950 px-3 text-white outline-none focus:border-sky-300"
            />
          </label>

          <label className="grid gap-1 text-sm">
            <span className="flex items-center justify-between font-semibold text-white/75">
              <span>削除理由（必須）</span>
              <span className={reason.length > 500 ? 'text-rose-200' : 'text-white/45'}>
                {reason.length}/500
              </span>
            </span>
            <textarea
              value={reason}
              maxLength={500}
              rows={4}
              disabled={isSubmitting}
              onChange={(event) => setReason(event.target.value)}
              className="rounded border border-white/20 bg-slate-950 px-3 py-2 text-white outline-none focus:border-sky-300"
            />
          </label>

          {errorMessage ? (
            <p role="alert" className="rounded border border-rose-300/40 bg-rose-500/15 px-3 py-2 text-sm text-rose-100">
              {errorMessage}
            </p>
          ) : null}

          <div className="flex justify-end gap-2 border-t border-white/15 pt-3">
            <Button type="button" variant="ghostOnDark" disabled={isSubmitting} onClick={onClose}>
              キャンセル
            </Button>
            <Button type="submit" variant="danger" disabled={!canSubmit}>
              {isSubmitting ? '削除中…' : '削除する'}
            </Button>
          </div>
        </form>
      ) : null}
    </Dialog>
  );
}
