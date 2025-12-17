import { useState } from 'react';
import { Link } from 'react-router-dom';

import { useRestoreFromDropbox, useBackupHistory } from '../../api/hooks';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';

export function BackupRestorePage() {
  const [backupPath, setBackupPath] = useState('');
  const [targetKind, setTargetKind] = useState<'database' | 'csv'>('csv');
  const [verifyIntegrity, setVerifyIntegrity] = useState(true);
  const [isRestoring, setIsRestoring] = useState(false);

  const restoreMutation = useRestoreFromDropbox();
  const { refetch: refetchHistory } = useBackupHistory({ operationType: 'RESTORE', limit: 5 });

  const handleRestore = async () => {
    if (!backupPath.trim()) {
      alert('バックアップパスを入力してください');
      return;
    }

    if (!confirm(`以下のバックアップをリストアしますか？\n\nパス: ${backupPath}\n対象: ${targetKind === 'database' ? 'データベース' : 'CSV'}\n整合性検証: ${verifyIntegrity ? '有効' : '無効'}`)) {
      return;
    }

    setIsRestoring(true);
    try {
      await restoreMutation.mutateAsync({
        backupPath: backupPath.trim(),
        targetKind,
        verifyIntegrity
      });
      alert('リストアが完了しました');
      setBackupPath('');
      refetchHistory();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'リストアに失敗しました';
      alert(`リストアに失敗しました: ${errorMessage}`);
    } finally {
      setIsRestoring(false);
    }
  };

  return (
    <Card
      title="Dropboxからリストア"
      action={
        <Link to="/admin/backup/history">
          <Button variant="ghost">履歴に戻る</Button>
        </Link>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-2">
            バックアップパス（Dropbox上のパス）
          </label>
          <input
            type="text"
            className="w-full rounded-md border-2 border-slate-300 bg-white p-2 text-sm font-semibold text-slate-900 font-mono"
            placeholder="/backups/csv/2025-12-16T04-00-00-000Z/employees.csv"
            value={backupPath}
            onChange={(e) => setBackupPath(e.target.value)}
            disabled={isRestoring}
          />
          <p className="mt-1 text-xs text-slate-600">
            例: /backups/csv/2025-12-16T04-00-00-000Z/employees.csv
          </p>
        </div>

        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-2">
            リストア対象
          </label>
          <select
            className="w-full rounded-md border-2 border-slate-300 bg-white p-2 text-sm font-semibold text-slate-900"
            value={targetKind}
            onChange={(e) => setTargetKind(e.target.value as 'database' | 'csv')}
            disabled={isRestoring}
          >
            <option value="csv">CSV（従業員・アイテム）</option>
            <option value="database">データベース</option>
          </select>
        </div>

        <div>
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <input
              type="checkbox"
              checked={verifyIntegrity}
              onChange={(e) => setVerifyIntegrity(e.target.checked)}
              disabled={isRestoring}
              className="rounded border-2 border-slate-300"
            />
            整合性検証を実行する（推奨）
          </label>
          <p className="mt-1 text-xs text-slate-600">
            バックアップファイルのハッシュ値とファイルサイズを検証します
          </p>
        </div>

        <div className="pt-4">
          <Button
            onClick={handleRestore}
            disabled={isRestoring || !backupPath.trim()}
            className="w-full md:w-auto"
          >
            {isRestoring ? 'リストア中...' : 'リストア実行'}
          </Button>
        </div>

        {restoreMutation.isError && (
          <div className="rounded-md border-2 border-red-700 bg-red-600 p-3 text-sm font-semibold text-white shadow-lg">
            エラー: {restoreMutation.error instanceof Error ? restoreMutation.error.message : 'リストアに失敗しました'}
          </div>
        )}

        {restoreMutation.isSuccess && (
          <div className="rounded-md border-2 border-emerald-700 bg-emerald-600 p-3 text-sm font-semibold text-white shadow-lg">
            リストアが完了しました
          </div>
        )}
      </div>
    </Card>
  );
}
