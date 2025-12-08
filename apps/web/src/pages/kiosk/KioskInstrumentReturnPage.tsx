import { FormEvent, useMemo, useState } from 'react';

import { returnMeasuringInstrument } from '../../api/client';
import { useActiveLoans } from '../../api/hooks';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';

import type { Loan } from '../../api/types';

export function KioskInstrumentReturnPage() {
  const loansQuery = useActiveLoans();
  const instrumentLoans = useMemo(
    () => (loansQuery.data ?? []).filter((loan) => loan.measuringInstrumentId),
    [loansQuery.data]
  );

  const [loanId, setLoanId] = useState('');
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setMessage(null);
    try {
      await handleReturn(loanId);
    } catch (error) {
      console.error(error);
      setMessage('エラーが発生しました。Loan IDを確認してください。');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReturn = async (targetLoanId: string) => {
    const loan = await returnMeasuringInstrument({
      loanId: targetLoanId,
      note: note || undefined
    });
    setMessage(`返却完了: Loan ID = ${loan.id}`);
    setLoanId('');
    setNote('');
    await loansQuery.refetch();
  };

  const renderLoanRow = (loan: Loan) => {
    const instrument = loan.measuringInstrument;
    return (
      <li
        key={loan.id}
        className="flex flex-col gap-2 rounded border border-white/10 bg-white/5 p-3 md:flex-row md:items-center md:justify-between"
      >
        <div className="flex flex-col text-sm">
          <span className="font-semibold text-white">
            {instrument?.name ?? '計測機器'}（{instrument?.managementNumber ?? '管理番号未登録'}）
          </span>
          <span className="text-white/80">Loan ID: {loan.id}</span>
          <span className="text-white/70">借用日時: {new Date(loan.borrowedAt).toLocaleString()}</span>
          <span className="text-white/70">氏名: {loan.employee?.displayName ?? '不明'}</span>
        </div>
        <div className="flex gap-2">
          <Button type="button" onClick={() => handleReturn(loan.id)}>
            返却
          </Button>
        </div>
      </li>
    );
  };

  return (
    <div className="flex flex-col items-center gap-6 p-6">
      <Card title="計測機器 返却">
        <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-2">
          <label className="text-sm text-white/70">
            Loan ID
            <Input
              value={loanId}
              onChange={(e) => setLoanId(e.target.value)}
              required
              placeholder="貸出一覧のIDを入力"
            />
          </label>
          <label className="text-sm text-white/70 md:col-span-2">
            備考
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="任意" />
          </label>
          <div className="md:col-span-2">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? '送信中…' : '返却登録'}
            </Button>
          </div>
        </form>
        {message ? <p className="mt-4 text-sm text-white/80">{message}</p> : null}
      </Card>

      <Card title="貸出中の計測機器">
        {loansQuery.isError ? (
          <p className="text-sm text-red-400">貸出一覧の取得に失敗しました。</p>
        ) : loansQuery.isLoading ? (
          <p className="text-sm text-white/70">読み込み中…</p>
        ) : instrumentLoans.length === 0 ? (
          <p className="text-sm text-white/70">計測機器の貸出はありません。</p>
        ) : (
          <ul className="grid gap-3">{instrumentLoans.map(renderLoanRow)}</ul>
        )}
      </Card>
    </div>
  );
}
