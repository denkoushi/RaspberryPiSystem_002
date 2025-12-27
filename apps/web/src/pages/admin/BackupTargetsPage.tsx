import { useState } from 'react';
import { Link } from 'react-router-dom';

import { useBackupConfig, useBackupConfigMutations } from '../../api/hooks';
import { BackupTargetForm } from '../../components/backup/BackupTargetForm';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';

import type { BackupTarget } from '../../api/backup';

export function BackupTargetsPage() {
  const { data: config, isLoading } = useBackupConfig();
  const { addTarget, updateTarget, deleteTarget, runBackup } = useBackupConfigMutations();
  const [isAdding, setIsAdding] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [runningIndex, setRunningIndex] = useState<number | null>(null);

  const targets = config?.targets ?? [];

  const handleToggleEnabled = async (index: number) => {
    const target = targets[index];
    await updateTarget.mutateAsync({
      index,
      target: { enabled: !target.enabled }
    });
  };

  const handleDelete = async (index: number) => {
    const target = targets[index];
    if (!confirm(`以下のバックアップ対象を削除しますか？\n\n種類: ${target.kind}\nソース: ${target.source}`)) {
      return;
    }
    await deleteTarget.mutateAsync(index);
  };

  const handleRun = async (index: number) => {
    const target = targets[index];
    setRunningIndex(index);
    try {
      await runBackup.mutateAsync({
        kind: target.kind,
        source: target.source
      });
      alert('バックアップを実行しました');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'バックアップに失敗しました';
      alert(`エラー: ${errorMessage}`);
    } finally {
      setRunningIndex(null);
    }
  };

  const handleAdd = async (target: Omit<BackupTarget, 'enabled'> & { enabled?: boolean }) => {
    await addTarget.mutateAsync(target);
    setIsAdding(false);
  };

  const handleEdit = async (index: number, target: Partial<BackupTarget>) => {
    await updateTarget.mutateAsync({ index, target });
    setEditingIndex(null);
  };

  const getKindLabel = (kind: BackupTarget['kind']) => {
    switch (kind) {
      case 'database':
        return 'データベース';
      case 'csv':
        return 'CSV';
      case 'image':
        return '画像';
      case 'file':
        return 'ファイル';
      case 'directory':
        return 'ディレクトリ';
      default:
        return kind;
    }
  };

  const formatSchedule = (schedule?: string) => {
    if (!schedule) return '-';
    // cron形式を読みやすく表示（簡易版）
    return schedule;
  };

  if (isLoading) {
    return (
      <Card title="バックアップ対象管理">
        <p className="text-sm font-semibold text-slate-700">読み込み中...</p>
      </Card>
    );
  }

  return (
    <Card
      title="バックアップ対象管理"
      action={
        <div className="flex gap-2">
          <Link to="/admin/backup/history">
            <Button variant="secondary">履歴</Button>
          </Link>
          <Link to="/admin/backup/restore">
            <Button variant="secondary">リストア</Button>
          </Link>
          <Button onClick={() => setIsAdding(true)} disabled={isAdding}>
            追加
          </Button>
        </div>
      }
    >
      {isAdding && (
        <div className="mb-4 rounded-md border-2 border-slate-500 bg-slate-50 p-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-900">新しいバックアップ対象を追加</h3>
          <BackupTargetForm
            onSubmit={handleAdd}
            onCancel={() => setIsAdding(false)}
            isLoading={addTarget.isPending}
          />
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-100">
            <tr className="border-b-2 border-slate-500">
              <th className="px-2 py-1 text-sm font-semibold text-slate-900">種類</th>
              <th className="px-2 py-1 text-sm font-semibold text-slate-900">ソース</th>
              <th className="px-2 py-1 text-sm font-semibold text-slate-900">スケジュール</th>
              <th className="px-2 py-1 text-sm font-semibold text-slate-900">有効</th>
              <th className="px-2 py-1 text-sm font-semibold text-slate-900">操作</th>
            </tr>
          </thead>
          <tbody>
            {targets.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-2 py-4 text-center text-sm text-slate-600">
                  バックアップ対象がありません
                </td>
              </tr>
            ) : (
              targets.map((target, index) => (
                <tr key={index} className="border-t border-slate-500">
                  <td className="px-2 py-1 text-sm text-slate-700">{getKindLabel(target.kind)}</td>
                  <td className="px-2 py-1 font-mono text-xs text-slate-700">{target.source}</td>
                  <td className="px-2 py-1 text-sm text-slate-700">{formatSchedule(target.schedule)}</td>
                  <td className="px-2 py-1">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={target.enabled}
                        onChange={() => handleToggleEnabled(index)}
                        disabled={updateTarget.isPending}
                        className="rounded border-2 border-slate-500"
                      />
                      <span className="text-sm text-slate-700">{target.enabled ? '有効' : '無効'}</span>
                    </label>
                  </td>
                  <td className="px-2 py-1">
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        onClick={() => handleRun(index)}
                        disabled={runningIndex === index || runBackup.isPending}
                        className="!text-slate-900 hover:!bg-slate-200 hover:!text-slate-900 border border-slate-300 px-2 py-1 text-sm font-semibold"
                      >
                        {runningIndex === index ? '実行中...' : '実行'}
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => setEditingIndex(editingIndex === index ? null : index)}
                        disabled={updateTarget.isPending}
                        className="!text-slate-900 hover:!bg-slate-200 hover:!text-slate-900 border border-slate-300 px-2 py-1 text-sm font-semibold"
                      >
                        {editingIndex === index ? 'キャンセル' : '編集'}
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => handleDelete(index)}
                        disabled={deleteTarget.isPending}
                        className="!text-red-700 hover:!bg-red-50 hover:!text-red-800 border border-red-300 px-2 py-1 text-sm font-semibold"
                      >
                        削除
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {editingIndex !== null && targets[editingIndex] && (
        <div className="mt-4 rounded-md border-2 border-slate-500 bg-slate-50 p-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-900">バックアップ対象を編集</h3>
          <BackupTargetForm
            initialValues={targets[editingIndex]}
            onSubmit={(target) => handleEdit(editingIndex, target)}
            onCancel={() => setEditingIndex(null)}
            isLoading={updateTarget.isPending}
          />
        </div>
      )}
    </Card>
  );
}
