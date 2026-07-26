import { useEffect, useRef } from 'react';

import { Button } from '../../components/ui/Button';
import { useNfcStream } from '../../hooks/useNfcStream';

type Props = {
  open: boolean;
  title: string;
  description: string;
  busy: boolean;
  error: string | null;
  onScan: (uid: string) => void;
  onCancel: () => void;
};

export function AssemblyOperatorNfcDialog({
  open,
  title,
  description,
  busy,
  error,
  onScan,
  onCancel
}: Props) {
  const nfcEvent = useNfcStream(open && !busy);
  const lastEventKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) lastEventKeyRef.current = null;
  }, [open]);

  useEffect(() => {
    if (!open || busy || !nfcEvent) return;
    const eventKey = `${nfcEvent.uid}:${nfcEvent.timestamp}`;
    if (lastEventKeyRef.current === eventKey) return;
    lastEventKeyRef.current = eventKey;
    onScan(nfcEvent.uid);
  }, [busy, nfcEvent, onScan, open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[1200] flex items-center justify-center bg-slate-950/85 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="assembly-operator-nfc-heading"
    >
      <section className="grid w-full max-w-lg gap-4 rounded-xl border border-cyan-300/35 bg-slate-900 p-5 text-white shadow-2xl">
        <div>
          <h2 id="assembly-operator-nfc-heading" className="text-xl font-bold">{title}</h2>
          <p className="mt-2 text-sm font-semibold text-white/70">{description}</p>
        </div>
        <div className="rounded-lg border border-cyan-300/30 bg-cyan-500/10 px-4 py-8 text-center">
          <p className="text-lg font-bold text-cyan-100">
            {busy ? '社員タグを確認中…' : '社員NFCタグをスキャンしてください'}
          </p>
          <p className="mt-2 text-xs font-semibold text-white/60">手入力では開始・再開できません</p>
        </div>
        {error ? (
          <p className="rounded border border-rose-300/30 bg-rose-500/10 px-3 py-2 text-sm font-semibold text-rose-100" role="alert">
            {error}
          </p>
        ) : null}
        <Button type="button" variant="secondary" disabled={busy} onClick={onCancel}>
          キャンセル
        </Button>
      </section>
    </div>
  );
}
