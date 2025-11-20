import { useState } from 'react';
import { useActiveLoans, useReturnMutation } from '../../api/hooks';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';

export function KioskReturnPage() {
  const [clientKey] = useLocalStorage('kiosk-client-key', 'client-demo-key');
  const [clientId] = useLocalStorage('kiosk-client-id', '');
  const [note, setNote] = useState('');
  const resolvedClientKey = clientKey || 'client-demo-key';
  const loansQuery = useActiveLoans(clientId || undefined, resolvedClientKey);
  const returnMutation = useReturnMutation(resolvedClientKey);

  const handleReturn = async (loanId: string) => {
    await returnMutation.mutateAsync({ loanId, clientId: clientId || undefined, note: note || undefined });
    await loansQuery.refetch();
    setNote('');
  };

  return (
    <Card title="返却一覧">
      {loansQuery.isLoading ? (
        <p>読み込み中...</p>
      ) : loansQuery.data && loansQuery.data.length > 0 ? (
        <div className="space-y-4">
          <label className="block text-sm text-white/70">
            備考（任意）
            <textarea
              className="mt-1 w-full rounded-md border border-white/10 bg-white/5 p-3 text-white"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <ul className="space-y-3">
            {loansQuery.data.map((loan) => (
              <li
                key={loan.id}
                className="flex flex-col gap-2 rounded-lg border border-white/10 bg-white/5 p-4 md:flex-row md:items-center md:justify-between"
              >
                <div>
                  <p className="text-lg font-semibold">{loan.item.name}</p>
                  <p className="text-sm text-white/70">{loan.employee.displayName}</p>
                  <p className="text-xs text-white/50">借用: {new Date(loan.borrowedAt).toLocaleString()}</p>
                </div>
                <Button
                  onClick={() => handleReturn(loan.id)}
                  disabled={returnMutation.isPending}
                  className="md:min-w-[140px]"
                >
                  {returnMutation.isPending ? '送信中…' : '返却する'}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p>現在貸出中のアイテムはありません。</p>
      )}
    </Card>
  );
}
