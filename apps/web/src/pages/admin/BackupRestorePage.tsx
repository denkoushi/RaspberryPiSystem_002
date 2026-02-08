import axios from 'axios';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { useRestoreFromDropbox, useBackupHistory, useRestoreDryRun } from '../../api/hooks';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';

import type { RestoreDryRunResponse } from '../../api/backup';

export function BackupRestorePage() {
  const [targetKind, setTargetKind] = useState<'database' | 'csv'>('csv');
  const [selectedHistoryId, setSelectedHistoryId] = useState<string>('');
  const [selectedBackupPath, setSelectedBackupPath] = useState<string>('');
  const [showExistsOnly, setShowExistsOnly] = useState(false);
  const [verifyIntegrity, setVerifyIntegrity] = useState(true);
  const [preBackup, setPreBackup] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [dryRunResult, setDryRunResult] = useState<RestoreDryRunResponse | null>(null);

  const restoreMutation = useRestoreFromDropbox();
  const dryRunMutation = useRestoreDryRun();
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
      .filter((item) => item.storageProvider === 'dropbox')
      .map((item) => ({
        id: item.id,
        startedAt: item.startedAt,
        targetKind: item.targetKind,
        targetSource: item.targetSource,
        sizeBytes: item.sizeBytes,
        fileStatus: item.fileStatus,
        path: toPath(item)
      }))
      .filter((item) => !!item.path)
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  }, [backupHistoryQuery.data]);

  const visibleCandidates = useMemo(() => {
    if (!showExistsOnly) return candidates;
    return candidates.filter((c) => c.fileStatus === 'EXISTS');
  }, [candidates, showExistsOnly]);

  const selectedCandidate = useMemo(
    () => candidates.find((c) => c.id === selectedHistoryId) ?? null,
    [candidates, selectedHistoryId]
  );

  useEffect(() => {
    setPreBackup(targetKind === 'database');
    setDryRunResult(null);
    if (!backupHistoryQuery.data) return;
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'debug-session',
        runId: 'ui-debug-1',
        hypothesisId: 'UI1',
        location: 'BackupRestorePage.tsx:useEffect(candidates)',
        message: 'Backup restore candidates computed',
        data: {
          targetKind,
          showExistsOnly,
          apiTotal: backupHistoryQuery.data.total,
          apiCount: backupHistoryQuery.data.history.length,
          candidatesCount: candidates.length,
          visibleCandidatesCount: visibleCandidates.length,
          hasSelection: Boolean(selectedHistoryId),
          selectedFileStatus: selectedCandidate?.fileStatus ?? null
        },
        timestamp: Date.now()
      })
    }).catch(() => {});
    // #endregion
  }, [
    backupHistoryQuery.data,
    candidates.length,
    selectedCandidate?.fileStatus,
    selectedHistoryId,
    showExistsOnly,
    targetKind,
    visibleCandidates.length
  ]);

  const formatRestoreError = (error: unknown) => {
    if (axios.isAxiosError(error)) {
      const data = error.response?.data as { message?: unknown } | undefined;
      const message = typeof data?.message === 'string' ? data.message : undefined;
      return message || error.message;
    }
    return error instanceof Error ? error.message : 'リストアに失敗しました';
  };

  const handleRestore = async () => {
    if (!selectedBackupPath.trim()) {
      alert('リストアするバックアップを選択してください');
      return;
    }

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'debug-session',
        runId: 'ui-debug-1',
        hypothesisId: 'UI2',
        location: 'BackupRestorePage.tsx:handleRestore',
        message: 'User initiated restore',
        data: {
          targetKind,
          verifyIntegrity,
          selectedHistoryId: selectedHistoryId || null,
          selectedFileStatus: selectedCandidate?.fileStatus ?? null,
          selectedBackupPathLength: selectedBackupPath.length
        },
        timestamp: Date.now()
      })
    }).catch(() => {});
    // #endregion

    if (
      !confirm(
        `以下のバックアップをリストアしますか？\n\n対象: ${targetKind === 'database' ? 'データベース' : 'CSV'}\nパス: ${selectedBackupPath}\n整合性検証: ${verifyIntegrity ? '有効' : '無効'}\n事前バックアップ: ${preBackup ? '有効' : '無効'}`
      )
    ) {
      return;
    }

    setIsRestoring(true);
    try {
      await restoreMutation.mutateAsync({
        backupPath: selectedBackupPath.trim(),
        targetKind,
        verifyIntegrity,
        preBackup: targetKind === 'database' ? preBackup : false
      });
      alert('リストアが完了しました');
      setSelectedBackupPath('');
      setSelectedHistoryId('');
      setDryRunResult(null);
      refetchRestoreHistory();
    } catch (error) {
      const errorMessage = formatRestoreError(error);
      alert(`リストアに失敗しました: ${errorMessage}`);
    } finally {
      setIsRestoring(false);
    }
  };

  const handleDryRun = async () => {
    if (!selectedBackupPath.trim()) {
      alert('リストアするバックアップを選択してください');
      return;
    }
    try {
      const result = await dryRunMutation.mutateAsync({
        backupPath: selectedBackupPath.trim(),
        targetKind,
        storage: { provider: 'dropbox' }
      });
      setDryRunResult(result);
    } catch (error) {
      const errorMessage = formatRestoreError(error);
      alert(`ドライランに失敗しました: ${errorMessage}`);
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
              リストアするバックアップ（Dropbox / 完了）
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
          ) : visibleCandidates.length === 0 ? (
            <div className="rounded-md border-2 border-slate-500 bg-slate-50 p-3 text-sm text-slate-700">
              <p className="font-semibold">該当するDropboxバックアップが見つかりません。</p>
              <p className="mt-1 text-xs text-slate-600">
                「バックアップ履歴」で storageProvider=dropbox / status=COMPLETED のバックアップがあるか確認してください。
              </p>
              <div className="mt-2">
                <Link to="/admin/backup/history">
                  <Button variant="secondary">バックアップ履歴を開く</Button>
                </Link>
              </div>
            </div>
          ) : (
            <>
              <label className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={showExistsOnly}
                  onChange={(e) => setShowExistsOnly(e.target.checked)}
                  disabled={isRestoring}
                  className="rounded border-2 border-slate-500"
                />
                fileStatus=EXISTS のみ表示
              </label>
              <select
                className="w-full rounded-md border-2 border-slate-500 bg-white p-2 text-sm font-semibold text-slate-900"
                value={selectedHistoryId}
                onChange={(e) => {
                  const id = e.target.value;
                  setSelectedHistoryId(id);
                  const selected = candidates.find((c) => c.id === id);
                  setSelectedBackupPath(selected?.path ?? '');
                  // #region agent log
                  fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      sessionId: 'debug-session',
                      runId: 'ui-debug-1',
                      hypothesisId: 'UI3',
                      location: 'BackupRestorePage.tsx:onChange(selectHistory)',
                      message: 'User selected backup history candidate',
                      data: {
                        targetKind,
                        showExistsOnly,
                        selectedHistoryId: id || null,
                        resolvedFileStatus: selected?.fileStatus ?? null,
                        resolvedPathLength: selected?.path?.length ?? 0
                      },
                      timestamp: Date.now()
                    })
                  }).catch(() => {});
                  // #endregion
                }}
                disabled={isRestoring}
              >
                <option value="">選択してください（最新{Math.min(visibleCandidates.length, 200)}件）</option>
                {visibleCandidates.map((item) => (
                  <option key={item.id} value={item.id}>
                    [{item.fileStatus}] {new Date(item.startedAt).toLocaleString()} / {item.targetKind} / {item.targetSource} / {item.path}
                  </option>
                ))}
              </select>
            </>
          )}

          {selectedBackupPath && (
            <div className="mt-2 rounded-md border-2 border-slate-500 bg-white p-2">
              <p className="text-xs font-semibold text-slate-700">選択中パス</p>
              <p className="mt-1 font-mono text-xs text-slate-900">{selectedBackupPath}</p>
            </div>
          )}

          {selectedCandidate?.fileStatus === 'DELETED' && (
            <div className="mt-2 rounded-md border-2 border-yellow-700 bg-yellow-600 p-3 text-sm font-semibold text-white shadow-lg">
              注意: この履歴は fileStatus=DELETED です（実ファイルがDropbox上に存在しない可能性があります）。
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
          <label className="mt-3 flex items-center gap-2 text-sm font-semibold text-slate-700">
            <input
              type="checkbox"
              checked={preBackup}
              onChange={(e) => setPreBackup(e.target.checked)}
              disabled={isRestoring || targetKind !== 'database'}
              className="rounded border-2 border-slate-500"
            />
            リストア前に事前バックアップを作成（DBのみ既定ON）
          </label>
          <p className="mt-1 text-xs text-slate-600">
            事前バックアップが失敗した場合はリストアを中断します
          </p>
        </div>

        <div className="pt-4">
          <div className="flex flex-col gap-2 md:flex-row">
            <Button
              variant="secondary"
              onClick={handleDryRun}
              disabled={isRestoring || dryRunMutation.isPending || !selectedBackupPath.trim()}
              className="w-full md:w-auto"
            >
              ドライラン
            </Button>
            <Button
              onClick={handleRestore}
              disabled={isRestoring || !selectedBackupPath.trim()}
              className="w-full md:w-auto"
            >
              {isRestoring ? 'リストア中...' : 'リストア実行'}
            </Button>
          </div>
        </div>

        {dryRunResult && (
          <div className="rounded-md border border-slate-300 bg-slate-50 p-3 text-xs text-slate-700">
            <div className="font-semibold text-slate-900">ドライラン結果</div>
            <div>対象: {dryRunResult.targetKind} / {dryRunResult.targetSource}</div>
            <div>存在確認: {dryRunResult.exists ? 'OK' : '未検出'}</div>
            <div>サイズ: {dryRunResult.sizeBytes ?? '-'}</div>
            <div>事前バックアップ既定: {dryRunResult.preBackupDefault ? '有効' : '無効'}</div>
          </div>
        )}

        {restoreMutation.isError && (
          <div className="rounded-md border-2 border-red-700 bg-red-600 p-3 text-sm font-semibold text-white shadow-lg">
            エラー: {formatRestoreError(restoreMutation.error)}
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
