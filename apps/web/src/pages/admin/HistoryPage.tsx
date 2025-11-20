import { useMemo, useState } from 'react';
import { useTransactions } from '../../api/hooks';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import type { Transaction } from '../../api/types';

export function HistoryPage() {
  const [page, setPage] = useState(1);
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  const filters = useMemo(
    () => ({
      startDate: startDate || undefined,
      endDate: endDate || undefined
    }),
    [startDate, endDate]
  );

  const { data, isLoading, isFetching } = useTransactions(page, filters);
  const transactions = data?.transactions ?? [];
  const totalPages = data ? Math.ceil(data.total / data.pageSize) : 1;

  const handleDownloadCsv = () => {
    const header = ['日時', 'アクション', 'アイテム', '従業員', '端末'];
    const rows = transactions.map((tx) => [
      new Date(tx.createdAt).toLocaleString(),
      tx.action,
      // スナップショットを優先し、無ければマスタ
      (tx.details as any)?.itemSnapshot?.name ?? tx.loan?.item.name ?? '-',
      (tx.details as any)?.employeeSnapshot?.name ?? tx.actorEmployee?.displayName ?? '-',
      tx.client?.name ?? '-'
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'transactions.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card title="履歴">
      <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div className="flex flex-col gap-2 md:flex-row md:items-end">
          <label className="block text-sm text-white/70">
            開始日時
            <input
              type="datetime-local"
              className="mt-1 rounded-md border border-white/10 bg-white/5 p-2 text-white"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </label>
          <label className="block text-sm text-white/70">
            終了日時
            <input
              type="datetime-local"
              className="mt-1 rounded-md border border-white/10 bg-white/5 p-2 text-white"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </label>
          <Button onClick={() => setPage(1)} disabled={isFetching}>
            フィルタ適用
          </Button>
        </div>
        <Button variant="ghost" onClick={handleDownloadCsv} disabled={transactions.length === 0}>
          CSVエクスポート
        </Button>
      </div>

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
                {transactions.map((tx: Transaction) => {
                  const itemName = (tx.details as any)?.itemSnapshot?.name ?? tx.loan?.item.name ?? '-';
                  const employeeName = (tx.details as any)?.employeeSnapshot?.name ?? tx.actorEmployee?.displayName ?? '-';
                  return (
                  <tr key={tx.id} className="border-t border-white/5">
                    <td className="px-2 py-1">{new Date(tx.createdAt).toLocaleString()}</td>
                    <td className="px-2 py-1">{tx.action}</td>
                    <td className="px-2 py-1">{itemName}</td>
                    <td className="px-2 py-1">{employeeName}</td>
                    <td className="px-2 py-1">{tx.client?.name ?? '-'}</td>
                  </tr>
                );
                })}
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
