import clsx from 'clsx';
import { useMemo, useState } from 'react';
import type { ClientDevice, ClientLogLevel } from '../../api/client';
import { useClients, useClientMutations, useClientStatuses, useClientLogs } from '../../api/hooks';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';

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
  const [selectedMode, setSelectedMode] = useState<'PHOTO' | 'TAG' | null>(null);
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
    setSelectedMode(client.defaultMode ?? 'TAG');
  };

  const handleSave = async (id: string) => {
    await update.mutateAsync({
      id,
      payload: { defaultMode: selectedMode }
    });
    setEditingId(null);
    setSelectedMode(null);
  };

  const handleCancel = () => {
    setEditingId(null);
    setSelectedMode(null);
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
              <article key={client.clientId} className="rounded-lg border border-white/10 bg-black/20 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-base font-semibold">{client.hostname}</p>
                    <p className="text-xs text-white/60">{client.ipAddress}</p>
                  </div>
                  <span
                    className={clsx(
                      'rounded-full px-3 py-1 text-xs font-semibold',
                      client.stale ? 'bg-red-500/20 text-red-200' : 'bg-emerald-500/20 text-emerald-100'
                    )}
                  >
                    {client.stale ? '12時間超オフライン' : 'オンライン'}
                  </span>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 text-sm text-white/80">
                  <div>
                    <dt className="text-xs text-white/50">CPU使用率</dt>
                    <dd className="text-lg font-semibold">{client.cpuUsage.toFixed(1)}%</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-white/50">メモリ使用率</dt>
                    <dd className="text-lg font-semibold">{client.memoryUsage.toFixed(1)}%</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-white/50">ディスク使用率</dt>
                    <dd className="text-lg font-semibold">{client.diskUsage.toFixed(1)}%</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-white/50">CPU温度</dt>
                    <dd className="text-lg font-semibold">{client.temperature != null ? `${client.temperature.toFixed(1)}°C` : '-'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-white/50">稼働時間</dt>
                    <dd className="text-base font-semibold">{formatUptime(client.uptimeSeconds)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-white/50">最終報告</dt>
                    <dd className="text-base font-semibold">{formatDateTime(client.lastSeen)}</dd>
                  </div>
                </dl>
                {client.latestLogs.length > 0 ? (
                  <div className="mt-4 rounded-md bg-white/5 p-2 text-xs text-white/80">
                    <p className="mb-1 text-[11px] uppercase tracking-wide text-white/50">最新ログ</p>
                    <ul className="space-y-1">
                      {client.latestLogs.slice(0, 3).map((log, index) => (
                        <li key={`${client.clientId}-${log.createdAt}-${index}`} className="flex items-start gap-2">
                          <span
                            className={clsx(
                              'rounded px-1 py-[1px] text-[10px] font-semibold',
                              log.level === 'ERROR'
                                ? 'bg-red-500/30 text-red-100'
                                : log.level === 'WARN'
                                ? 'bg-amber-400/30 text-amber-100'
                                : 'bg-slate-500/30 text-slate-100'
                            )}
                          >
                            {log.level}
                          </span>
                          <span className="flex-1">{log.message}</span>
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
            <span className="mb-1 block text-white/70">クライアント</span>
            <select
              value={logClientFilter}
              onChange={(e) => setLogClientFilter(e.target.value)}
              className="w-full rounded-md border border-white/20 bg-white/5 px-3 py-2 text-white"
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
            <span className="mb-1 block text-white/70">ログレベル</span>
            <select
              value={logLevelFilter}
              onChange={(e) => setLogLevelFilter(e.target.value as 'ALL' | ClientLogLevel)}
              className="w-full rounded-md border border-white/20 bg-white/5 px-3 py-2 text-white"
            >
              <option value="ALL">すべて</option>
              <option value="ERROR">ERROR</option>
              <option value="WARN">WARN</option>
              <option value="INFO">INFO</option>
              <option value="DEBUG">DEBUG</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-white/70">取得件数（最大200）</span>
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
            <p className="text-red-400">ログの取得に失敗しました</p>
          ) : logsQuery.isLoading ? (
            <p>読み込み中...</p>
          ) : logsQuery.data && logsQuery.data.length > 0 ? (
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-xs uppercase text-white/60">
                  <th className="px-3 py-2">時刻 (JST)</th>
                  <th className="px-3 py-2">クライアント</th>
                  <th className="px-3 py-2">レベル</th>
                  <th className="px-3 py-2">メッセージ</th>
                </tr>
              </thead>
              <tbody>
                {logsQuery.data.map((log) => (
                  <tr key={`${log.id ?? `${log.clientId}-${log.createdAt}`}`} className="border-b border-white/5">
                    <td className="px-3 py-2 align-top text-xs text-white/70">{formatDateTime(log.createdAt)}</td>
                    <td className="px-3 py-2 align-top font-mono text-xs text-white/80">{log.clientId}</td>
                    <td className="px-3 py-2 align-top">
                      <span
                        className={clsx(
                          'rounded px-2 py-1 text-xs font-semibold',
                          log.level === 'ERROR'
                            ? 'bg-red-500/20 text-red-100'
                            : log.level === 'WARN'
                            ? 'bg-amber-400/20 text-amber-900'
                            : log.level === 'INFO'
                            ? 'bg-emerald-500/20 text-emerald-100'
                            : 'bg-slate-500/30 text-slate-100'
                        )}
                      >
                        {log.level}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-white/80">{log.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p>表示できるログがありません。</p>
          )}
        </div>
      </Card>

      <Card title="クライアント端末管理">
        {clientsQuery.isError ? (
          <p className="text-red-400">クライアント端末一覧の取得に失敗しました</p>
        ) : clientsQuery.isLoading ? (
          <p>読み込み中...</p>
        ) : clientsQuery.data && clientsQuery.data.length > 0 ? (
          <div className="space-y-4">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="px-4 py-2 text-left">名前</th>
                  <th className="px-4 py-2 text-left">場所</th>
                  <th className="px-4 py-2 text-left">APIキー</th>
                  <th className="px-4 py-2 text-left">初期表示</th>
                  <th className="px-4 py-2 text-left">最終確認</th>
                  <th className="px-4 py-2 text-left">操作</th>
                </tr>
              </thead>
              <tbody>
                {clientsQuery.data.map((client: ClientDevice) => (
                  <tr key={client.id} className="border-b border-white/5">
                    <td className="px-4 py-2">{client.name}</td>
                    <td className="px-4 py-2 text-white/70">{client.location ?? '-'}</td>
                    <td className="px-4 py-2 font-mono text-xs text-white/60">{client.apiKey}</td>
                    <td className="px-4 py-2">
                      {editingId === client.id ? (
                        <select
                          value={selectedMode ?? 'TAG'}
                          onChange={(e) => setSelectedMode(e.target.value as 'PHOTO' | 'TAG')}
                          className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-white"
                        >
                          <option value="TAG">2タグスキャン</option>
                          <option value="PHOTO">写真撮影持出</option>
                        </select>
                      ) : (
                        <span>{client.defaultMode === 'PHOTO' ? '写真撮影持出' : '2タグスキャン'}</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-sm text-white/60">{formatDateTime(client.lastSeenAt)}</td>
                    <td className="px-4 py-2">
                      {editingId === client.id ? (
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
          <p>クライアント端末が登録されていません。</p>
        )}
      </Card>
    </div>
  );
}

