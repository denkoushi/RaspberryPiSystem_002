import { useState } from 'react';
import { Link } from 'react-router-dom';

import { useBackupConfig, useBackupConfigMutations, useBackupConfigHealth } from '../../api/hooks';
import { BackupTargetForm } from '../../components/backup/BackupTargetForm';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';

import type { BackupTarget } from '../../api/backup';

export function BackupTargetsPage() {
  const { data: config, isLoading } = useBackupConfig();
  const { data: health, isLoading: isHealthLoading } = useBackupConfigHealth();
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
      case 'client-file':
        return 'クライアントファイル';
      case 'client-directory':
        return 'クライアントディレクトリ';
      default:
        return kind;
    }
  };

  const formatSchedule = (schedule?: string) => {
    if (!schedule) return '-';
    
    // cron形式を読みやすく表示
    const parts = schedule.trim().split(/\s+/);
    if (parts.length !== 5) {
      return schedule; // 不正な形式の場合はそのまま表示
    }

    const minute = parts[0];
    const hour = parts[1];
    const dayOfWeek = parts[4];

    const hourNum = parseInt(hour, 10);
    const minuteNum = parseInt(minute, 10);
    if (isNaN(hourNum) || isNaN(minuteNum)) {
      return schedule;
    }

    const time = `${hourNum.toString().padStart(2, '0')}:${minuteNum.toString().padStart(2, '0')}`;

    const DAYS_OF_WEEK = ['日', '月', '火', '水', '木', '金', '土'];
    let dayLabel = '';
    if (dayOfWeek === '*') {
      dayLabel = '毎日';
    } else {
      const days = dayOfWeek
        .split(',')
        .map((d) => parseInt(d.trim(), 10))
        .filter((d) => !isNaN(d) && d >= 0 && d <= 6)
        .sort((a, b) => a - b)
        .map((d) => DAYS_OF_WEEK[d])
        .join(',');
      dayLabel = days || '不明';
    }

    return `${time} (${dayLabel})`;
  };

  if (isLoading) {
    return (
      <Card title="バックアップ対象管理">
        <p className="text-sm font-semibold text-slate-700">読み込み中...</p>
      </Card>
    );
  }

  const getStorageProviderLabel = (target?: BackupTarget) => {
    // Dropboxのアクセストークンが設定されているかチェック（新構造と旧構造の両方に対応）
    const hasDropboxAccessToken = !!(
      (config?.storage?.options?.dropbox?.accessToken && config.storage.options.dropbox.accessToken !== '') ||
      (config?.storage?.options?.accessToken && config.storage.options.accessToken !== '')
    );
    
    // Phase 2: providers配列が指定されている場合は複数表示
    if (target?.storage?.providers && target.storage.providers.length > 0) {
      const labels = target.storage.providers.map((p) => {
        if (p === 'dropbox') {
          return hasDropboxAccessToken ? 'Dropbox' : 'Dropbox（未設定）';
        }
        return 'ローカル';
      });
      return labels.join(' + ');
    }
    
    // 対象ごとのストレージプロバイダーが指定されている場合はそれを使用
    const provider = target?.storage?.provider ?? config?.storage?.provider;
    if (!provider) return '不明';
    
    if (provider === 'dropbox') {
      return hasDropboxAccessToken ? 'Dropbox' : 'Dropbox（未設定・ローカルにフォールバック）';
    }
    return 'ローカルストレージ';
  };

  const getStoragePath = (target?: BackupTarget) => {
    // Phase 2: providers配列が指定されている場合は複数表示
    if (target?.storage?.providers && target.storage.providers.length > 0) {
      const paths = target.storage.providers.map((p) => {
        if (p === 'dropbox') {
          const basePath = config?.storage?.options?.basePath || '/backups';
          return `Dropbox: ${basePath}`;
        }
        return config?.storage?.options?.basePath || '/opt/backups';
      });
      return paths.join(' / ');
    }
    
    // 対象ごとのストレージプロバイダーが指定されている場合はそれを使用
    const provider = target?.storage?.provider ?? config?.storage?.provider;
    if (!config?.storage) return '-';
    
    if (provider === 'dropbox') {
      const basePath = config.storage.options?.basePath || '/backups';
      return `Dropbox: ${basePath}`;
    }
    return config.storage.options?.basePath || '/opt/backups';
  };

  const getRetentionLabel = (target?: BackupTarget) => {
    // Phase 3: 対象ごとの保持期間設定を表示
    if (target?.retention) {
      const parts: string[] = [];
      if (target.retention.days) {
        parts.push(`${target.retention.days}日`);
      }
      if (target.retention.maxBackups) {
        parts.push(`最大${target.retention.maxBackups}件`);
      }
      return parts.length > 0 ? parts.join(' / ') : '-';
    }
    
    // 全体設定を使用する場合
    if (config?.retention) {
      const parts: string[] = [];
      if (config.retention.days) {
        parts.push(`${config.retention.days}日`);
      }
      if (config.retention.maxBackups) {
        parts.push(`最大${config.retention.maxBackups}件`);
      }
      return parts.length > 0 ? `全体設定: ${parts.join(' / ')}` : '-';
    }
    
    return '-';
  };

  const getStatusColor = (status: 'healthy' | 'warning' | 'error') => {
    switch (status) {
      case 'healthy':
        return 'bg-green-100 text-green-800 border-green-300';
      case 'warning':
        return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'error':
        return 'bg-red-100 text-red-800 border-red-300';
    }
  };

  const getStatusLabel = (status: 'healthy' | 'warning' | 'error') => {
    switch (status) {
      case 'healthy':
        return '正常';
      case 'warning':
        return '警告';
      case 'error':
        return 'エラー';
    }
  };

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
      {/* ヘルスチェック結果の表示 */}
      {!isHealthLoading && health && health.issues.length > 0 && (
        <div className={`mb-4 rounded-md border-2 p-4 ${getStatusColor(health.status)}`}>
          <div className="flex items-center gap-2 mb-2">
            <span className="font-semibold">設定の健全性: {getStatusLabel(health.status)}</span>
            <span className="text-xs">({health.issues.length}件の問題を検出)</span>
          </div>
          <div className="space-y-2">
            {health.issues.map((issue, index) => (
              <div key={index} className="text-sm">
                <div className="font-semibold">{issue.severity === 'error' ? '❌' : '⚠️'} {issue.message}</div>
                {issue.details && (
                  <div className="ml-4 mt-1 text-xs opacity-80">
                    {Object.entries(issue.details).map(([key, value]) => (
                      <div key={key}>
                        <span className="font-mono">{key}</span>: {String(value)}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {isAdding && (
        <div className="mb-4 rounded-md border-2 border-slate-500 bg-slate-50 p-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-900">新しいバックアップ対象を追加</h3>
          <BackupTargetForm
            onSubmit={handleAdd}
            onCancel={() => setIsAdding(false)}
            isLoading={addTarget.isPending}
            storageProvider={(config?.storage?.provider === 'gmail' ? 'local' : config?.storage?.provider) || 'local'}
            storagePath={getStoragePath()}
          />
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-100">
            <tr className="border-b-2 border-slate-500">
              <th className="px-2 py-1 text-sm font-semibold text-slate-900">種類</th>
              <th className="px-2 py-1 text-sm font-semibold text-slate-900">ソース</th>
              <th className="px-2 py-1 text-sm font-semibold text-slate-900">バックアップ先</th>
              <th className="px-2 py-1 text-sm font-semibold text-slate-900">スケジュール</th>
              <th className="px-2 py-1 text-sm font-semibold text-slate-900">保持期間</th>
              <th className="px-2 py-1 text-sm font-semibold text-slate-900">有効</th>
              <th className="px-2 py-1 text-sm font-semibold text-slate-900">操作</th>
            </tr>
          </thead>
          <tbody>
            {targets.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-2 py-4 text-center text-sm text-slate-600">
                  バックアップ対象がありません
                </td>
              </tr>
            ) : (
              targets.map((target, index) => (
                <tr key={index} className="border-t border-slate-500">
                  <td className="px-2 py-1 text-sm text-slate-700">{getKindLabel(target.kind)}</td>
                  <td className="px-2 py-1 font-mono text-xs text-slate-700">{target.source}</td>
                  <td className="px-2 py-1 text-sm text-slate-700">
                    <div className="flex flex-col gap-1">
                      <span className="font-semibold">{getStorageProviderLabel(target)}</span>
                      <span className="font-mono text-xs text-slate-600">{getStoragePath(target)}</span>
                    </div>
                  </td>
                  <td className="px-2 py-1 text-sm text-slate-700">{formatSchedule(target.schedule)}</td>
                  <td className="px-2 py-1 text-xs text-slate-600">{getRetentionLabel(target)}</td>
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
                    <div className="flex gap-2">
                      <Button
                        onClick={() => handleRun(index)}
                        disabled={runningIndex === index || runBackup.isPending}
                        className="px-2 py-1 text-sm"
                      >
                        {runningIndex === index ? '実行中...' : '実行'}
                      </Button>
                      <Button
                        onClick={() => setEditingIndex(editingIndex === index ? null : index)}
                        disabled={updateTarget.isPending}
                        className="px-2 py-1 text-sm"
                      >
                        {editingIndex === index ? 'キャンセル' : '編集'}
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => handleDelete(index)}
                        disabled={deleteTarget.isPending}
                        className="px-2 py-1 text-sm"
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
            storageProvider={(config?.storage?.provider === 'gmail' ? 'local' : config?.storage?.provider) || 'local'}
            storagePath={getStoragePath()}
          />
        </div>
      )}
    </Card>
  );
}
