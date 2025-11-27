import { useState } from 'react';
import { useActiveLoans, useReturnMutation } from '../../api/hooks';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import type { UseQueryResult } from '@tanstack/react-query';
import type { Loan } from '../../api/types';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';

interface KioskReturnPageProps {
  loansQuery?: UseQueryResult<Loan[], Error>;
  clientId?: string;
  clientKey?: string;
}

export function KioskReturnPage({ loansQuery: providedLoansQuery, clientId: providedClientId, clientKey: providedClientKey }: KioskReturnPageProps = {}) {
  // propsでデータが提供されていない場合は自分で取得（/kiosk/returnルート用）
  const [localClientKey] = useLocalStorage('kiosk-client-key', 'client-demo-key');
  const [localClientId] = useLocalStorage('kiosk-client-id', '');
  const resolvedClientKey = providedClientKey || localClientKey || 'client-demo-key';
  const resolvedClientId = providedClientId !== undefined ? providedClientId : (localClientId || undefined);
  
  // propsで提供されている場合はuseActiveLoansを呼び出さない（重複リクエストを防ぐ）
  // React Queryのenabledオプションを使用して、propsがない場合のみクエリを実行
  const ownLoansQuery = useActiveLoans(resolvedClientId, resolvedClientKey, {
    enabled: !providedLoansQuery // propsが提供されていない場合のみ有効化
  });
  
  // propsで提供されている場合はそれを使用、なければ自分で取得したものを使用
  const loansQuery = providedLoansQuery || ownLoansQuery;
  const [note, setNote] = useState('');
  const returnMutation = useReturnMutation(resolvedClientKey);

  const handleReturn = async (loanId: string) => {
    await returnMutation.mutateAsync({ loanId, clientId: resolvedClientId || undefined, note: note || undefined });
    await loansQuery.refetch();
    setNote('');
  };

  return (
    <Card title="返却一覧">
      {loansQuery.isError ? (
        <p className="text-red-400">返却一覧の取得に失敗しました</p>
      ) : loansQuery.isLoading ? (
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
                  <p className="text-lg font-semibold">{loan.item?.name ?? 'アイテム情報なし'}</p>
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
          {loansQuery.isFetching ? <p className="text-xs text-white/60">更新中...</p> : null}
        </div>
      ) : (
        <p>現在貸出中のアイテムはありません。</p>
      )}
    </Card>
  );
}
