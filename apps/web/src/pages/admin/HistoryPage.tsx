import { useState } from 'react';
import { useTransactions } from '../../api/hooks';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import type { Transaction } from '../../api/types';

export function HistoryPage() {
  const [page, setPage] = useState(1);
  const { data, isLoading, isFetching } = useTransactions(page);
  const transactions = data?.transactions ?? [];
  const totalPages = data ? Math.ceil(data.total / data.pageSize) : 1;

  return (
    <Card title="履歴">
      {isLoading ? (
        <p>読み込み中...</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-white/60">
                <tr>
                  <th className="px-2 py-1">日時</th>
                  <th className="px-2 py-1">アクション</th>
                  <th className="px-2 py-1">アイテム</th>
                  <th className="px-2 py-1">従業員</th>
                  <th className="px-2 py-1">端末</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx: Transaction) => (
                  <tr key={tx.id} className="border-t border-white/5">
                    <td className="px-2 py-1">{new Date(tx.createdAt).toLocaleString()}</td>
                    <td className="px-2 py-1">{tx.action}</td>
                    <td className="px-2 py-1">{tx.loan?.item.name ?? '-'}</td>
                    <td className="px-2 py-1">{tx.actorEmployee?.displayName ?? '-'}</td>
                    <td className="px-2 py-1">{tx.client?.name ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex items-center justify-between text-sm text-white/70">
            <Button variant="ghost" disabled={page <= 1 || isFetching} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              前へ
            </Button>
            <p>
              {(data?.page ?? page)} / {totalPages}
            </p>
            <Button
              variant="ghost"
              disabled={!!data && data.total <= data.page * data.pageSize}
              onClick={() => setPage((p) => p + 1)}
            >
              次へ
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}
