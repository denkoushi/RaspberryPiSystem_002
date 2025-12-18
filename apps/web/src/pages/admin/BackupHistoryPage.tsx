import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { useBackupHistory } from '../../api/hooks';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';

import type { BackupOperationType, BackupStatus } from '../../api/backup';

export function BackupHistoryPage() {
  const [page, setPage] = useState(1);
  const [operationTypeFilter, setOperationTypeFilter] = useState<BackupOperationType | ''>('');
  const [statusFilter, setStatusFilter] = useState<BackupStatus | ''>('');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  const filters = useMemo(
    () => ({
      operationType: operationTypeFilter || undefined,
      status: statusFilter || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      offset: (page - 1) * 20,
      limit: 20
    }),
    [operationTypeFilter, statusFilter, startDate, endDate, page]
  );

  const { data, isLoading, isFetching } = useBackupHistory(filters);
  const history = data?.history ?? [];
  const totalPages = data ? Math.ceil(data.total / 20) : 1;

  const getStatusColor = (status: BackupStatus) => {
    switch (status) {
      case 'COMPLETED':
        return 'text-emerald-600';
      case 'FAILED':
        return 'text-red-600';
      case 'PROCESSING':
        return 'text-blue-600';
      case 'PENDING':
        return 'text-yellow-600';
      default:
        return 'text-slate-600';
    }
  };

  const getStatusLabel = (status: BackupStatus) => {
    switch (status) {
      case 'COMPLETED':
        return '完了';
      case 'FAILED':
        return '失敗';
      case 'PROCESSING':
        return '処理中';
      case 'PENDING':
        return '待機中';
      default:
        return status;
    }
  };

  const getOperationTypeLabel = (type: BackupOperationType) => {
    return type === 'BACKUP' ? 'バックアップ' : 'リストア';
  };

  const formatFileSize = (bytes?: number | null) => {
    if (!bytes) return '-';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <Card
      title="バックアップ履歴"
      action={
        <Link to="/admin/backup/restore">
          <Button variant="secondary">Dropboxからリストア</Button>
        </Link>
      }
    >
      <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div className="flex flex-col gap-2 md:flex-row md:items-end">
          <label className="block text-sm font-semibold text-slate-700">
            操作種別
            <select
              className="mt-1 rounded-md border-2 border-slate-500 bg-white p-2 text-sm font-semibold text-slate-900"
              value={operationTypeFilter}
              onChange={(e) => {
                setOperationTypeFilter(e.target.value as BackupOperationType | '');
                setPage(1);
              }}
            >
              <option value="">すべて</option>
              <option value="BACKUP">バックアップ</option>
              <option value="RESTORE">リストア</option>
            </select>
          </label>
          <label className="block text-sm font-semibold text-slate-700">
            ステータス
            <select
              className="mt-1 rounded-md border-2 border-slate-500 bg-white p-2 text-sm font-semibold text-slate-900"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value as BackupStatus | '');
                setPage(1);
              }}
            >
              <option value="">すべて</option>
              <option value="COMPLETED">完了</option>
              <option value="FAILED">失敗</option>
              <option value="PROCESSING">処理中</option>
              <option value="PENDING">待機中</option>
            </select>
          </label>
          <label className="block text-sm font-semibold text-slate-700">
            開始日時
            <input
              type="datetime-local"
              className="mt-1 rounded-md border-2 border-slate-500 bg-white p-2 text-sm font-semibold text-slate-900"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setPage(1);
              }}
            />
          </label>
          <label className="block text-sm font-semibold text-slate-700">
            終了日時
            <input
              type="datetime-local"
              className="mt-1 rounded-md border-2 border-slate-500 bg-white p-2 text-sm font-semibold text-slate-900"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                setPage(1);
              }}
            />
          </label>
          <Button onClick={() => setPage(1)} disabled={isFetching}>
            フィルタ適用
          </Button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm font-semibold text-slate-700">読み込み中...</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-100">
                <tr className="border-b-2 border-slate-500">
                  <th className="px-2 py-1 text-sm font-semibold text-slate-900">日時</th>
                  <th className="px-2 py-1 text-sm font-semibold text-slate-900">操作種別</th>
                  <th className="px-2 py-1 text-sm font-semibold text-slate-900">対象</th>
                  <th className="px-2 py-1 text-sm font-semibold text-slate-900">ストレージ</th>
                  <th className="px-2 py-1 text-sm font-semibold text-slate-900">ステータス</th>
                  <th className="px-2 py-1 text-sm font-semibold text-slate-900">サイズ</th>
                  <th className="px-2 py-1 text-sm font-semibold text-slate-900">パス</th>
                  <th className="px-2 py-1 text-sm font-semibold text-slate-900">エラー</th>
                </tr>
              </thead>
              <tbody>
                {history.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-2 py-4 text-center text-sm text-slate-600">
                      履歴がありません
                    </td>
                  </tr>
                ) : (
                  history.map((item) => (
                    <tr key={item.id} className="border-t border-slate-500">
                      <td className="px-2 py-1 text-sm text-slate-700">{new Date(item.startedAt).toLocaleString()}</td>
                      <td className="px-2 py-1 text-sm text-slate-700">{getOperationTypeLabel(item.operationType)}</td>
                      <td className="px-2 py-1 text-sm text-slate-700">
                        {item.targetKind} ({item.targetSource})
                      </td>
                      <td className="px-2 py-1 text-sm text-slate-700">{item.storageProvider}</td>
                      <td className={`px-2 py-1 text-sm font-semibold ${getStatusColor(item.status)}`}>
                        {getStatusLabel(item.status)}
                      </td>
                      <td className="px-2 py-1 text-sm text-slate-700">{formatFileSize(item.sizeBytes)}</td>
                      <td className="px-2 py-1 font-mono text-xs text-slate-700">{item.backupPath || '-'}</td>
                      <td className="px-2 py-1 text-sm font-semibold text-red-600">
                        {item.errorMessage ? (
                          <span title={item.errorMessage}>{item.errorMessage.substring(0, 50)}...</span>
                        ) : (
                          '-'
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex items-center justify-between text-sm font-semibold text-slate-700">
            <Button variant="ghost" disabled={page <= 1 || isFetching} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              前へ
            </Button>
            <p>
              {page} / {totalPages} (全{data?.total ?? 0}件)
            </p>
            <Button
              variant="ghost"
              disabled={!!data && data.total <= page * 20}
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
