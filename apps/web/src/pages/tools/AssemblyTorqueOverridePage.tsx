import { useState, type FormEvent } from 'react';

import {
  listCurrentTorqueWrenchConfirmations,
  recordAssemblyTorqueOverride,
  type CurrentTorqueWrenchConfirmationApi
} from '../../api/client';
import { getApiErrorMessage } from '../../api/errors';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';

export function AssemblyTorqueOverridePage() {
  const [sessionId, setSessionId] = useState('');
  const [confirmations, setConfirmations] = useState<CurrentTorqueWrenchConfirmationApi[]>([]);
  const [confirmationId, setConfirmationId] = useState('');
  const [value, setValue] = useState('');
  const [unit, setUnit] = useState('N·m');
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadConfirmations = async () => {
    const normalizedSessionId = sessionId.trim();
    if (!normalizedSessionId) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await listCurrentTorqueWrenchConfirmations(normalizedSessionId);
      setConfirmations(result);
      setConfirmationId(result[0]?.id ?? '');
      setMessage(result.length > 0 ? '現在の丸数字に有効な確認済みレンチを読み込みました。' : '有効な確認済みレンチがありません。');
    } catch (error) {
      setConfirmations([]);
      setConfirmationId('');
      setMessage(getApiErrorMessage(error, '作業セッションを取得できませんでした。'));
    } finally {
      setBusy(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const result = await recordAssemblyTorqueOverride(sessionId.trim(), {
        confirmationId,
        value: Number(value),
        unit,
        reason: reason.trim()
      });
      const label = result.outcome.kind === 'accepted_ok' ? 'OKとして受付し、次の締付位置へ進みました。' : 'NG実績として記録し、現在位置を維持しました。';
      const nextConfirmations = await listCurrentTorqueWrenchConfirmations(sessionId.trim());
      setConfirmations(nextConfirmations);
      setConfirmationId(nextConfirmations[0]?.id ?? '');
      setMessage(`管理者例外入力を${label}`);
      setValue('');
      setReason('');
    } catch (error) {
      setMessage(getApiErrorMessage(error, '管理者例外入力に失敗しました。'));
    } finally {
      setBusy(false);
    }
  };

  const selected = confirmations.find((confirmation) => confirmation.id === confirmationId) ?? null;

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4 text-white">
      <div>
        <h1 className="text-2xl font-bold">組立トルク管理者例外入力</h1>
        <p className="mt-1 text-sm text-white/60">通信不通時の代替入力です。適合・校正・現物確認の安全条件は回避できません。
        </p>
      </div>
      <section className="grid gap-3 rounded border border-white/15 bg-slate-900/70 p-4">
        <label className="grid gap-1 text-sm font-semibold">
          作業セッションID
          <div className="flex gap-2">
            <Input required value={sessionId} onChange={(event) => setSessionId(event.target.value)} />
            <Button type="button" variant="primary" disabled={busy || !sessionId.trim()} onClick={() => void loadConfirmations()}>
              読み込み
            </Button>
          </div>
        </label>
        {message ? <div className="rounded border border-cyan-300/30 bg-cyan-950/30 px-3 py-2 text-sm">{message}</div> : null}
      </section>
      <form className="grid gap-4 rounded border border-white/15 bg-slate-900/70 p-4" onSubmit={submit}>
        <label className="grid gap-1 text-sm font-semibold">
          現在有効なレンチ確認
          <select
            className="min-h-10 rounded bg-slate-950 px-3"
            required
            value={confirmationId}
            onChange={(event) => setConfirmationId(event.target.value)}
          >
            <option value="">選択してください</option>
            {confirmations.map((confirmation) => (
              <option key={confirmation.id} value={confirmation.id}>
                丸数字 {confirmation.markerNo} / {confirmation.serialNumber} / {confirmation.manufacturer} {confirmation.modelNumber}
              </option>
            ))}
          </select>
        </label>
        {selected ? (
          <div className="rounded border border-emerald-300/25 bg-emerald-950/20 p-3 text-sm">
            丸数字 {selected.markerNo}：{selected.setting.lowerLimit} / {selected.setting.nominalTorque} / {selected.setting.upperLimit} {selected.setting.unit}
          </div>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-[12rem_9rem]">
          <label className="grid gap-1 text-sm font-semibold">実績値<Input required type="number" step="any" value={value} onChange={(event) => setValue(event.target.value)} /></label>
          <label className="grid gap-1 text-sm font-semibold">単位<select className="min-h-10 rounded bg-slate-950 px-3" value={unit} onChange={(event) => setUnit(event.target.value)}><option>N·m</option><option>kgf·cm</option></select></label>
        </div>
        <label className="grid gap-1 text-sm font-semibold">
          例外入力の理由（監査記録に保存）
          <textarea className="min-h-24 rounded bg-slate-950 p-3" required maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} />
        </label>
        <Button type="submit" variant="primary" disabled={busy || !confirmationId || !value || !reason.trim()}>監査情報付きで記録</Button>
      </form>
    </div>
  );
}
