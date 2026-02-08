import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { useBackupConfigHistory, useBackupConfigHistoryById } from '../../api/hooks';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';

export function BackupConfigHistoryPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data, isLoading } = useBackupConfigHistory({ offset: 0, limit: 50 });
  const { data: detail } = useBackupConfigHistoryById(selectedId ?? undefined);

  const rows = useMemo(() => data?.history ?? [], [data]);

  const formatDate = (value?: string) => {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString('ja-JP');
  };

  return (
    <Card
      title="バックアップ設定変更履歴"
      action={
        <div className="flex gap-2">
          <Link to="/admin/backup/targets">
            <Button variant="secondary">対象管理</Button>
          </Link>
          <Link to="/admin/backup/history">
            <Button variant="secondary">バックアップ履歴</Button>
          </Link>
        </div>
      }
    >
      {isLoading && <p className="text-sm text-slate-600">読み込み中...</p>}
      {!isLoading && rows.length === 0 && (
        <p className="text-sm text-slate-600">変更履歴がありません。</p>
      )}

      {!isLoading && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-100">
              <tr className="border-b-2 border-slate-500">
                <th className="px-2 py-1 font-semibold text-slate-900">日時</th>
                <th className="px-2 py-1 font-semibold text-slate-900">操作</th>
                <th className="px-2 py-1 font-semibold text-slate-900">実行者</th>
                <th className="px-2 py-1 font-semibold text-slate-900">概要</th>
                <th className="px-2 py-1 font-semibold text-slate-900">詳細</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-slate-500">
                  <td className="px-2 py-1 text-xs text-slate-700">{formatDate(row.createdAt)}</td>
                  <td className="px-2 py-1 text-sm text-slate-700">{row.actionType}</td>
                  <td className="px-2 py-1 text-sm text-slate-700">{row.actorUsername || '-'}</td>
                  <td className="px-2 py-1 text-sm text-slate-700">{row.summary || '-'}</td>
                  <td className="px-2 py-1">
                    <Button
                      variant="ghost"
                      className="px-2 py-1 text-sm"
                      onClick={() => setSelectedId(selectedId === row.id ? null : row.id)}
                    >
                      {selectedId === row.id ? '閉じる' : '表示'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedId && detail && (
        <div className="mt-4 rounded-md border border-slate-300 bg-slate-50 p-3">
          <div className="mb-2 text-sm font-semibold text-slate-900">変更詳細</div>
          <pre className="max-h-80 overflow-auto text-xs text-slate-700">
            {JSON.stringify(detail.diff ?? detail.snapshotRedacted, null, 2)}
          </pre>
        </div>
      )}
    </Card>
  );
}
