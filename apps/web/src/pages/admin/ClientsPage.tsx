import clsx from 'clsx';
import { useMemo, useState } from 'react';

import { useClients, useClientMutations, useClientStatuses, useClientLogs } from '../../api/hooks';
import { SignagePdfManager } from '../../components/signage/SignagePdfManager';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';

import type { ClientDevice, ClientLogLevel } from '../../api/client';

const MAX_CLIENT_NAME_LENGTH = 100;

function formatUptime(seconds?: number | null) {
  if (!seconds) return '-';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

export function ClientsPage() {
  const clientsQuery = useClients();
  const statusQuery = useClientStatuses();
  const [logClientFilter, setLogClientFilter] = useState<string>('all');
  const [logLevelFilter, setLogLevelFilter] = useState<'ALL' | ClientLogLevel>('ALL');
  const [logLimit, setLogLimit] = useState<number>(50);
  const logFilters = useMemo(
    () => ({
      clientId: logClientFilter === 'all' ? undefined : logClientFilter,
      level: logLevelFilter === 'ALL' ? undefined : logLevelFilter,
      limit: logLimit
    }),
    [logClientFilter, logLevelFilter, logLimit]
  );
  const logsQuery = useClientLogs(logFilters);
  const { update } = useClientMutations();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [selectedMode, setSelectedMode] = useState<'PHOTO' | 'TAG' | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat('ja-JP', {
        dateStyle: 'short',
        timeStyle: 'medium',
        timeZone: 'Asia/Tokyo'
      }),
    []
  );
  const statusData = useMemo(() => statusQuery.data ?? [], [statusQuery.data]);
  const clientOptions = useMemo(
    () => statusData.map((status) => ({ id: status.clientId, label: status.hostname || status.clientId })),
    [statusData]
  );

  const handleEdit = (client: ClientDevice) => {
    setEditingId(client.id);
    setEditingName(client.name);
    setSelectedMode(client.defaultMode ?? 'TAG');
    setEditError(null);
  };

  const handleSave = async (id: string) => {
    const normalizedName = editingName.trim();
    if (normalizedName.length === 0) {
      setEditError('名前を入力してください。');
      return;
    }
    if (normalizedName.length > MAX_CLIENT_NAME_LENGTH) {
      setEditError(`名前は${MAX_CLIENT_NAME_LENGTH}文字以内で入力してください。`);
      return;
    }

    try {
      await update.mutateAsync({
        id,
        payload: { name: normalizedName, defaultMode: selectedMode }
      });
      setEditingId(null);
      setEditingName('');
      setSelectedMode(null);
      setEditError(null);
    } catch {
      setEditError('保存に失敗しました。時間をおいて再試行してください。');
    }
  };

  const handleCancel = () => {
    setEditingId(null);
    setEditingName('');
    setSelectedMode(null);
    setEditError(null);
  };

  const formatDateTime = (iso?: string | null) => (iso ? dateFormatter.format(new Date(iso)) : '-');

  return (
    <div className="space-y-6">
      <Card
        title="クライアント稼働状況"
        action={
          <Button onClick={() => statusQuery.refetch()} disabled={statusQuery.isRefetching} variant="secondary">
            {statusQuery.isRefetching ? '更新中…' : '今すぐ更新'}
          </Button>
        }
      >
        {statusQuery.isError ? (
          <p className="text-red-400">状態の取得に失敗しました</p>
        ) : statusQuery.isLoading ? (
          <p>読み込み中...</p>
        ) : statusData.length === 0 ? (
          <p>まだレポートを受信していません。status-agent が動作するとここに表示されます。</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {statusData.map((client) => (
              <article key={client.clientId} className="rounded-lg border-2 border-slate-500 bg-white p-4 shadow-lg">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-base font-bold text-slate-900">{client.hostname}</p>
                    <p className="text-xs font-semibold text-slate-700">{client.ipAddress}</p>
                  </div>
                  <span
                    className={clsx(
                      'rounded-full px-3 py-1 text-xs font-bold',
                      client.stale ? 'bg-red-600 text-white' : 'bg-emerald-600 text-white'
                    )}
                  >
                    {client.stale ? '12時間超オフライン' : 'オンライン'}
                  </span>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                  <div>
                    <dt className="text-xs font-semibold text-slate-700">CPU使用率</dt>
                    <dd className="text-lg font-bold text-slate-900">{client.cpuUsage.toFixed(1)}%</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold text-slate-700">メモリ使用率</dt>
                    <dd className="text-lg font-bold text-slate-900">{client.memoryUsage.toFixed(1)}%</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold text-slate-700">ディスク使用率</dt>
                    <dd className="text-lg font-bold text-slate-900">{client.diskUsage.toFixed(1)}%</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold text-slate-700">CPU温度</dt>
                    <dd className="text-lg font-bold text-slate-900">{client.temperature != null ? `${client.temperature.toFixed(1)}°C` : '-'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold text-slate-700">稼働時間</dt>
                    <dd className="text-base font-bold text-slate-900">{formatUptime(client.uptimeSeconds)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold text-slate-700">最終報告</dt>
                    <dd className="text-base font-bold text-slate-900">{formatDateTime(client.lastSeen)}</dd>
                  </div>
                </dl>
                {client.latestLogs.length > 0 ? (
                  <div className="mt-4 rounded-md border border-slate-500 bg-slate-100 p-2 text-xs">
                    <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-700">最新ログ</p>
                    <ul className="space-y-1">
                      {client.latestLogs.slice(0, 3).map((log, index) => (
                        <li key={`${client.clientId}-${log.createdAt}-${index}`} className="flex items-start gap-2">
                          <span
                            className={clsx(
                              'rounded px-1 py-[1px] text-xs font-bold',
                              log.level === 'ERROR'
                                ? 'bg-red-600 text-white'
                                : log.level === 'WARN'
                                ? 'bg-amber-500 text-white'
                                : 'bg-slate-600 text-white'
                            )}
                          >
                            {log.level}
                          </span>
                          <span className="flex-1 text-sm font-semibold text-slate-900">{log.message}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </Card>

      <Card
        title="クライアント最新ログ"
        action={
          <Button onClick={() => logsQuery.refetch()} disabled={logsQuery.isRefetching} variant="secondary">
            {logsQuery.isRefetching ? '更新中…' : '今すぐ更新'}
          </Button>
        }
      >
        <div className="grid gap-4 md:grid-cols-4">
          <label className="text-sm">
            <span className="mb-1 block font-semibold text-slate-700">クライアント</span>
            <select
              value={logClientFilter}
              onChange={(e) => setLogClientFilter(e.target.value)}
              className="w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
            >
              <option value="all">すべて</option>
              {clientOptions.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-semibold text-slate-700">ログレベル</span>
            <select
              value={logLevelFilter}
              onChange={(e) => setLogLevelFilter(e.target.value as 'ALL' | ClientLogLevel)}
              className="w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
            >
              <option value="ALL">すべて</option>
              <option value="ERROR">ERROR</option>
              <option value="WARN">WARN</option>
              <option value="INFO">INFO</option>
              <option value="DEBUG">DEBUG</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-semibold text-slate-700">取得件数（最大200）</span>
            <Input
              type="number"
              min={10}
              max={200}
              step={10}
              value={logLimit}
              onChange={(e) => setLogLimit(Number(e.target.value) || 50)}
            />
          </label>
        </div>

        <div className="mt-4 overflow-x-auto">
          {logsQuery.isError ? (
            <p className="text-sm font-semibold text-red-600">ログの取得に失敗しました</p>
          ) : logsQuery.isLoading ? (
            <p className="text-sm text-slate-700">読み込み中...</p>
          ) : logsQuery.data && logsQuery.data.length > 0 ? (
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="border-b-2 border-slate-500 text-left text-sm font-bold uppercase text-slate-900">
                  <th className="px-3 py-2">時刻 (JST)</th>
                  <th className="px-3 py-2">クライアント</th>
                  <th className="px-3 py-2">レベル</th>
                  <th className="px-3 py-2">メッセージ</th>
                </tr>
              </thead>
              <tbody>
                {logsQuery.data.map((log) => (
                  <tr key={`${log.id ?? `${log.clientId}-${log.createdAt}`}`} className="border-b border-slate-500">
                    <td className="px-3 py-2 align-top text-sm font-semibold text-slate-700">{formatDateTime(log.createdAt)}</td>
                    <td className="px-3 py-2 align-top font-mono text-sm font-semibold text-slate-900">{log.clientId}</td>
                    <td className="px-3 py-2 align-top">
                      <span
                        className={clsx(
                          'rounded px-2 py-1 text-xs font-bold',
                          log.level === 'ERROR'
                            ? 'bg-red-600 text-white'
                            : log.level === 'WARN'
                            ? 'bg-amber-500 text-white'
                            : log.level === 'INFO'
                            ? 'bg-emerald-600 text-white'
                            : 'bg-slate-600 text-white'
                        )}
                      >
                        {log.level}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-sm font-semibold text-slate-900">{log.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-slate-700">表示できるログがありません。</p>
          )}
        </div>
      </Card>

      <Card title="クライアント端末管理">
        {clientsQuery.isError ? (
          <p className="text-sm font-semibold text-red-600">クライアント端末一覧の取得に失敗しました</p>
        ) : clientsQuery.isLoading ? (
          <p className="text-sm text-slate-700">読み込み中...</p>
        ) : clientsQuery.data && clientsQuery.data.length > 0 ? (
          <div className="space-y-4">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b-2 border-slate-500">
                  <th className="px-4 py-2 text-left text-sm font-bold text-slate-900">名前</th>
                  <th className="px-4 py-2 text-left text-sm font-bold text-slate-900">場所</th>
                  <th className="px-4 py-2 text-left text-sm font-bold text-slate-900">APIキー</th>
                  <th className="px-4 py-2 text-left text-sm font-bold text-slate-900">初期表示</th>
                  <th className="px-4 py-2 text-left text-sm font-bold text-slate-900">最終確認</th>
                  <th className="px-4 py-2 text-left text-sm font-bold text-slate-900">操作</th>
                </tr>
              </thead>
              <tbody>
                {clientsQuery.data.map((client: ClientDevice) => (
                  <tr key={client.id} className="border-b border-slate-500">
                    <td className="px-4 py-2 font-bold text-base text-slate-900">
                      {editingId === client.id ? (
                        <Input
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          maxLength={MAX_CLIENT_NAME_LENGTH}
                          aria-label="クライアント名"
                        />
                      ) : (
                        client.name
                      )}
                    </td>
                    <td className="px-4 py-2 text-sm font-semibold text-slate-700">{client.location ?? '-'}</td>
                    <td className="px-4 py-2 font-mono text-sm font-semibold text-slate-700">{client.apiKey}</td>
                    <td className="px-4 py-2">
                      {editingId === client.id ? (
                        <select
                          value={selectedMode ?? 'TAG'}
                          onChange={(e) => setSelectedMode(e.target.value as 'PHOTO' | 'TAG')}
                          className="rounded-md border-2 border-slate-500 bg-white px-2 py-1 text-sm font-semibold text-slate-900"
                        >
                          <option value="TAG">2タグスキャン</option>
                          <option value="PHOTO">写真撮影持出</option>
                        </select>
                      ) : (
                        <span className="text-sm font-semibold text-slate-900">{client.defaultMode === 'PHOTO' ? '写真撮影持出' : '2タグスキャン'}</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-sm font-semibold text-slate-700">{formatDateTime(client.lastSeenAt)}</td>
                    <td className="px-4 py-2">
                      {editingId === client.id ? (
                        <div className="space-y-1">
                          <div className="flex gap-2">
                            <Button
                              onClick={() => handleSave(client.id)}
                              disabled={update.isPending}
                              className="px-3 py-1 text-sm"
                            >
                              保存
                            </Button>
                            <Button
                              onClick={handleCancel}
                              disabled={update.isPending}
                              variant="ghost"
                              className="px-3 py-1 text-sm"
                            >
                              キャンセル
                            </Button>
                          </div>
                          {editError ? <p className="text-xs font-semibold text-red-600">{editError}</p> : null}
                        </div>
                      ) : (
                        <Button onClick={() => handleEdit(client)} className="px-3 py-1 text-sm">
                          編集
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          ) : (
            <p className="text-sm text-slate-700">クライアント端末が登録されていません。</p>
          )}
        </Card>
      <SignagePdfManager title="サイネージPDFアップロード（キオスク向け）" />
    </div>
  );
}
