import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { useRestoreFromDropbox, useBackupHistory } from '../../api/hooks';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';

export function BackupRestorePage() {
  const [targetKind, setTargetKind] = useState<'database' | 'csv'>('csv');
  const [selectedHistoryId, setSelectedHistoryId] = useState<string>('');
  const [selectedBackupPath, setSelectedBackupPath] = useState<string>('');
  const [verifyIntegrity, setVerifyIntegrity] = useState(true);
  const [isRestoring, setIsRestoring] = useState(false);

  const restoreMutation = useRestoreFromDropbox();
  const { refetch: refetchRestoreHistory } = useBackupHistory({ operationType: 'RESTORE', limit: 5 });
  const backupHistoryQuery = useBackupHistory({
    operationType: 'BACKUP',
    status: 'COMPLETED',
    targetKind,
    // 履歴が多い運用を想定して多めに取得し、UI側でdropbox/EXISTSなどを絞り込む
    offset: 0,
    limit: 200
  });

  const candidates = useMemo(() => {
    const history = backupHistoryQuery.data?.history ?? [];
    const toPath = (item: (typeof history)[number]) => {
      const summaryPath = (item.summary as { path?: unknown } | null | undefined)?.path;
      const path = item.backupPath ?? (typeof summaryPath === 'string' ? summaryPath : undefined);
      return path?.trim() ? path.trim() : '';
    };

    return history
      .filter((item) => item.operationType === 'BACKUP')
      .filter((item) => item.status === 'COMPLETED')
      .filter((item) => item.fileStatus === 'EXISTS')
      .filter((item) => item.storageProvider === 'dropbox')
      .map((item) => ({
        id: item.id,
        startedAt: item.startedAt,
        targetKind: item.targetKind,
        targetSource: item.targetSource,
        sizeBytes: item.sizeBytes,
        path: toPath(item)
      }))
      .filter((item) => !!item.path)
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  }, [backupHistoryQuery.data]);

  const handleRestore = async () => {
    if (!selectedBackupPath.trim()) {
      alert('リストアするバックアップを選択してください');
      return;
    }

    if (
      !confirm(
        `以下のバックアップをリストアしますか？\n\n対象: ${targetKind === 'database' ? 'データベース' : 'CSV'}\nパス: ${selectedBackupPath}\n整合性検証: ${verifyIntegrity ? '有効' : '無効'}`
      )
    ) {
      return;
    }

    setIsRestoring(true);
    try {
      await restoreMutation.mutateAsync({
        backupPath: selectedBackupPath.trim(),
        targetKind,
        verifyIntegrity
      });
      alert('リストアが完了しました');
      setSelectedBackupPath('');
      setSelectedHistoryId('');
      refetchRestoreHistory();
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
            リストア対象
          </label>
          <select
            className="w-full rounded-md border-2 border-slate-500 bg-white p-2 text-sm font-semibold text-slate-900"
            value={targetKind}
            onChange={(e) => {
              setTargetKind(e.target.value as 'database' | 'csv');
              // 種別変更時は選択をクリア（誤操作防止）
              setSelectedBackupPath('');
              setSelectedHistoryId('');
            }}
            disabled={isRestoring}
          >
            <option value="csv">CSV（従業員・アイテム）</option>
            <option value="database">データベース</option>
          </select>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <label className="block text-sm font-semibold text-slate-700">
              リストアするバックアップ（Dropbox / 完了 / ファイル存在）
            </label>
            <Button
              variant="ghost"
              disabled={isRestoring || backupHistoryQuery.isFetching}
              onClick={() => backupHistoryQuery.refetch()}
            >
              一覧更新
            </Button>
          </div>

          {backupHistoryQuery.isLoading ? (
            <p className="text-sm font-semibold text-slate-700">読み込み中...</p>
          ) : candidates.length === 0 ? (
            <div className="rounded-md border-2 border-slate-500 bg-slate-50 p-3 text-sm text-slate-700">
              <p className="font-semibold">該当するDropboxバックアップが見つかりません。</p>
              <p className="mt-1 text-xs text-slate-600">
                「バックアップ履歴」で storageProvider=dropbox / status=COMPLETED / file=EXISTS のバックアップがあるか確認してください。
              </p>
              <div className="mt-2">
                <Link to="/admin/backup/history">
                  <Button variant="secondary">バックアップ履歴を開く</Button>
                </Link>
              </div>
            </div>
          ) : (
            <select
              className="w-full rounded-md border-2 border-slate-500 bg-white p-2 text-sm font-semibold text-slate-900"
              value={selectedHistoryId}
              onChange={(e) => {
                const id = e.target.value;
                setSelectedHistoryId(id);
                const selected = candidates.find((c) => c.id === id);
                setSelectedBackupPath(selected?.path ?? '');
              }}
              disabled={isRestoring}
            >
              <option value="">選択してください（最新{Math.min(candidates.length, 200)}件）</option>
              {candidates.map((item) => (
                <option key={item.id} value={item.id}>
                  {new Date(item.startedAt).toLocaleString()} / {item.targetKind} / {item.targetSource} / {item.path}
                </option>
              ))}
            </select>
          )}

          {selectedBackupPath && (
            <div className="mt-2 rounded-md border-2 border-slate-500 bg-white p-2">
              <p className="text-xs font-semibold text-slate-700">選択中パス</p>
              <p className="mt-1 font-mono text-xs text-slate-900">{selectedBackupPath}</p>
            </div>
          )}
        </div>

        <div>
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <input
              type="checkbox"
              checked={verifyIntegrity}
              onChange={(e) => setVerifyIntegrity(e.target.checked)}
              disabled={isRestoring}
              className="rounded border-2 border-slate-500"
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
            disabled={isRestoring || !selectedBackupPath.trim()}
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
