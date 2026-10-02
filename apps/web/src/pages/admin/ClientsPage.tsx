import {
  KIOSK_INITIAL_ROUTE_LABELS,
  KIOSK_SELECTABLE_INITIAL_ROUTE_IDS,
  isKioskSelectableInitialRouteId,
  normalizeKioskInitialRoute,
  type KioskInitialRouteId
} from '@raspi-system/shared-types';
import clsx from 'clsx';
import { useMemo, useState } from 'react';

import {
  useClients,
  useClientMutations,
  useClientStatuses,
  useClientLogs,
  useCreateSite,
  useSites
} from '../../api/hooks';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';

import type { ClientDevice, ClientLogLevel, ClientStatusEntry } from '../../api/client';

const MAX_CLIENT_NAME_LENGTH = 100;
type EditableKioskInitialRoute = KioskInitialRouteId | '';

type ClientForm = {
  name: string;
  initialRoute: EditableKioskInitialRoute;
  mode: 'PHOTO' | 'TAG';
  siteKey: string;
  proxy: boolean;
  haizenEdge: boolean;
  shelfLayout: boolean;
};

/** 台帳（ClientDevice）と稼働状況（ClientStatusEntry）を1行にまとめたもの。台帳にない報告は device が null */
type ClientRow = { id: string; device: ClientDevice | null; status: ClientStatusEntry | null };

type RowFilter = 'all' | 'online' | 'offline' | 'noSite' | 'error';
type LeftTab = 'devices' | 'logs' | 'sites';

const FORM_FIELD_LABELS: Record<keyof ClientForm, string> = {
  name: '名前',
  initialRoute: '起動先',
  mode: '旧設定',
  siteKey: '拠点',
  proxy: '代理操作',
  haizenEdge: 'Zero2W配膳',
  shelfLayout: '棚レイアウト編集'
};
const FORM_FIELDS = Object.keys(FORM_FIELD_LABELS) as Array<keyof ClientForm>;

const selectClassName =
  'w-full rounded-md border-2 border-slate-500 bg-white px-3 py-2 text-sm font-semibold text-slate-900 focus:border-emerald-500 focus:outline-none';
const changedClassName = 'border-emerald-600 bg-emerald-50';

function formFromDevice(device: ClientDevice): ClientForm {
  return {
    name: device.name,
    initialRoute: normalizeKioskInitialRoute(device.kioskInitialRoute) ?? '',
    mode: device.defaultMode ?? 'TAG',
    siteKey: device.siteKey ?? '',
    proxy: Boolean(device.canProxyOtherDevices),
    haizenEdge: Boolean(device.haizenEdgeEnabled),
    shelfLayout: Boolean(device.shelfLayoutEditEnabled)
  };
}

function legacyModeLabel(mode?: 'PHOTO' | 'TAG' | null) {
  return mode === 'PHOTO' ? '写真撮影持出' : '2タグスキャン';
}

function formValueLabel(field: keyof ClientForm, form: ClientForm): string {
  switch (field) {
    case 'name':
      return form.name;
    case 'initialRoute':
      return form.initialRoute ? KIOSK_INITIAL_ROUTE_LABELS[form.initialRoute] : '未設定';
    case 'mode':
      return legacyModeLabel(form.mode);
    case 'siteKey':
      return form.siteKey || '未設定';
    default:
      return form[field] ? 'オン' : 'オフ';
  }
}

function formatUptime(seconds?: number | null) {
  if (!seconds) return '-';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function hasErrorLog(status: ClientStatusEntry | null) {
  return Boolean(status?.latestLogs.some((log) => log.level === 'ERROR'));
}

function matchesFilter(row: ClientRow, filter: RowFilter) {
  switch (filter) {
    case 'online':
      return Boolean(row.status && !row.status.stale);
    case 'offline':
      return Boolean(row.status?.stale);
    case 'noSite':
      return Boolean(row.device && !row.device.siteKey);
    case 'error':
      return hasErrorLog(row.status);
    default:
      return true;
  }
}

function StatusDot({ status }: { status: ClientStatusEntry | null }) {
  return (
    <span
      className={clsx(
        'h-2.5 w-2.5 shrink-0 rounded-full',
        !status ? 'bg-slate-400' : status.stale ? 'bg-red-600' : 'bg-emerald-600'
      )}
      aria-hidden="true"
    />
  );
}

function Meter({ value, warnAt, dangerAt }: { value: number; warnAt: number; dangerAt: number }) {
  return (
    <span className="block h-1.5 overflow-hidden rounded-full bg-slate-200" aria-hidden="true">
      <span
        className={clsx(
          'block h-full rounded-full',
          value >= dangerAt ? 'bg-red-600' : value >= warnAt ? 'bg-amber-500' : 'bg-slate-900'
        )}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </span>
  );
}

function LogLevelBadge({ level }: { level: ClientLogLevel }) {
  return (
    <span
      className={clsx(
        'rounded px-1.5 py-0.5 font-mono text-xs font-bold text-white',
        level === 'ERROR'
          ? 'bg-red-600'
          : level === 'WARN'
            ? 'bg-amber-600'
            : level === 'INFO'
              ? 'bg-emerald-600'
              : 'bg-slate-600'
      )}
    >
      {level}
    </span>
  );
}

function Switch({
  label,
  ariaLabel,
  checked,
  onChange
}: {
  label: string;
  ariaLabel: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 border-t border-slate-300 py-2 first:border-t-0">
      <span className="text-sm font-semibold text-slate-900">{label}</span>
      <input
        type="checkbox"
        role="switch"
        aria-label={ariaLabel}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className="relative h-6 w-10 shrink-0 rounded-full bg-slate-400 transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-transform peer-checked:bg-emerald-600 peer-checked:after:translate-x-4 peer-focus-visible:ring-2 peer-focus-visible:ring-emerald-500 peer-focus-visible:ring-offset-2"
      />
    </label>
  );
}

export function ClientsPage() {
  const clientsQuery = useClients();
  const statusQuery = useClientStatuses();
  const sitesQuery = useSites();
  const createSiteMutation = useCreateSite();
  const { update } = useClientMutations();

  const [tab, setTab] = useState<LeftTab>('devices');
  const [rowFilter, setRowFilter] = useState<RowFilter>('all');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // 端末ごとの未保存の編集。別の端末を選んでも消さない
  const [drafts, setDrafts] = useState<Record<string, ClientForm>>({});
  const [editError, setEditError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

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

  const [newSiteKey, setNewSiteKey] = useState('');
  const [siteError, setSiteError] = useState<string | null>(null);

  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat('ja-JP', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZone: 'Asia/Tokyo'
      }),
    []
  );
  const formatDateTime = (iso?: string | null) => (iso ? dateFormatter.format(new Date(iso)) : '-');

  const statusData = useMemo(() => statusQuery.data ?? [], [statusQuery.data]);
  const sites = sitesQuery.data ?? [];

  const rows = useMemo<ClientRow[]>(() => {
    const statusByClientId = new Map(statusData.map((status) => [status.clientId, status]));
    const linked = new Set<string>();
    const deviceRows = (clientsQuery.data ?? []).map((device) => {
      const status = device.statusClientId ? (statusByClientId.get(device.statusClientId) ?? null) : null;
      if (status) linked.add(status.clientId);
      return { id: device.id, device, status };
    });
    const statusOnlyRows = statusData
      .filter((status) => !linked.has(status.clientId))
      .map((status) => ({ id: `status:${status.clientId}`, device: null, status }));
    return [...deviceRows, ...statusOnlyRows];
  }, [clientsQuery.data, statusData]);

  const counts = useMemo(
    () =>
      (['all', 'online', 'offline', 'noSite', 'error'] as const).reduce(
        (acc, filter) => ({ ...acc, [filter]: rows.filter((row) => matchesFilter(row, filter)).length }),
        {} as Record<RowFilter, number>
      ),
    [rows]
  );

  const keyword = search.trim().toLowerCase();
  const visibleRows = rows.filter(
    (row) =>
      matchesFilter(row, rowFilter) &&
      (!keyword ||
        `${row.device?.name ?? ''} ${row.status?.hostname ?? ''} ${row.device?.location ?? ''}`
          .toLowerCase()
          .includes(keyword))
  );

  const selected = rows.find((row) => row.id === selectedId) ?? rows[0] ?? null;
  const selectedDevice = selected?.device ?? null;
  const savedForm = selectedDevice ? formFromDevice(selectedDevice) : null;
  const form = selectedDevice && savedForm ? (drafts[selectedDevice.id] ?? savedForm) : null;
  const changedFields = form && savedForm ? FORM_FIELDS.filter((field) => form[field] !== savedForm[field]) : [];
  const isDirty = changedFields.length > 0;

  const isRowDirty = (row: ClientRow) => {
    const draft = row.device ? drafts[row.device.id] : undefined;
    if (!row.device || !draft) return false;
    const saved = formFromDevice(row.device);
    return FORM_FIELDS.some((field) => draft[field] !== saved[field]);
  };

  const selectRow = (id: string) => {
    setSelectedId(id);
    setEditError(null);
    setSavedId(null);
  };

  const patchForm = (patch: Partial<ClientForm>) => {
    if (!selectedDevice || !form) return;
    setDrafts((current) => ({ ...current, [selectedDevice.id]: { ...form, ...patch } }));
    setEditError(null);
    setSavedId(null);
  };

  const discardDraft = (id: string) => {
    setDrafts((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== id)));
    setEditError(null);
  };

  const handleSave = async () => {
    if (!selectedDevice || !form) return;
    const normalizedName = form.name.trim();
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
        id: selectedDevice.id,
        payload: {
          name: normalizedName,
          defaultMode: form.mode,
          kioskInitialRoute: form.initialRoute || null,
          haizenEdgeEnabled: form.haizenEdge,
          shelfLayoutEditEnabled: form.shelfLayout,
          siteKey: form.siteKey || null,
          canProxyOtherDevices: form.proxy
        }
      });
      discardDraft(selectedDevice.id);
      setSavedId(selectedDevice.id);
    } catch {
      setEditError('保存に失敗しました。時間をおいて再試行してください。');
    }
  };

  const handleCopyApiKey = async (device: ClientDevice) => {
    try {
      await navigator.clipboard.writeText(device.apiKey);
      setCopiedId(device.id);
    } catch {
      setCopiedId(null);
    }
  };

  const handleCreateSite = async () => {
    const key = newSiteKey.trim();
    if (!key) {
      setSiteError('拠点名を入力してください。');
      return;
    }
    if (key.includes(' - ')) {
      setSiteError('拠点名に「 - 」は使えません。');
      return;
    }
    try {
      await createSiteMutation.mutateAsync({ key });
      setNewSiteKey('');
      setSiteError(null);
    } catch {
      setSiteError('拠点の登録に失敗しました。同じ名前が既にないか確認してください。');
    }
  };

  const handleRefresh = () => {
    void statusQuery.refetch();
    void clientsQuery.refetch();
  };

  const filterChips: Array<{ id: RowFilter; label: string; dot?: string }> = [
    { id: 'all', label: 'すべて' },
    { id: 'online', label: 'オンライン', dot: 'bg-emerald-500' },
    { id: 'offline', label: 'オフライン', dot: 'bg-red-500' },
    { id: 'noSite', label: '拠点未設定', dot: 'bg-amber-400' },
    { id: 'error', label: 'エラーあり', dot: 'bg-red-500' }
  ];
  const tabs: Array<{ id: LeftTab; label: string }> = [
    { id: 'devices', label: '端末' },
    { id: 'logs', label: 'ログ' },
    { id: 'sites', label: '拠点' }
  ];
  const isLoading = clientsQuery.isLoading || statusQuery.isLoading;
  const status = selected?.status ?? null;
  const vitals = status
    ? [
        { label: 'CPU', value: status.cpuUsage, unit: '%', warnAt: 65, dangerAt: 85 },
        { label: 'メモリ', value: status.memoryUsage, unit: '%', warnAt: 75, dangerAt: 90 },
        { label: 'ディスク', value: status.diskUsage, unit: '%', warnAt: 80, dangerAt: 90 },
        { label: '温度', value: status.temperature ?? null, unit: '°C', warnAt: 60, dangerAt: 70 }
      ]
    : [];

  return (
    <div className="flex flex-col gap-3 lg:h-[calc(100dvh-5.5rem)]">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="text-xl font-bold text-white">クライアント端末</h1>
        <div className="flex flex-wrap gap-1.5">
          {filterChips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              aria-pressed={rowFilter === chip.id}
              onClick={() => {
                setRowFilter(chip.id);
                setTab('devices');
              }}
              className={clsx(
                'flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-semibold transition-colors',
                rowFilter === chip.id
                  ? 'border-white bg-white text-slate-900'
                  : 'border-white/25 text-white hover:bg-white/10'
              )}
            >
              {chip.dot ? <span className={clsx('h-2 w-2 rounded-full', chip.dot)} aria-hidden="true" /> : null}
              {chip.label}
              <span className="font-bold tabular-nums">{counts[chip.id]}</span>
            </button>
          ))}
        </div>
        <Button
          type="button"
          variant="ghostOnDark"
          onClick={handleRefresh}
          disabled={statusQuery.isRefetching}
          className="ml-auto px-3 py-1 text-sm"
        >
          {statusQuery.isRefetching ? '更新中…' : '今すぐ更新'}
        </Button>
      </div>

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_25rem]">
        <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl bg-white text-slate-900 shadow-lg">
          <div className="flex flex-wrap items-center gap-x-1 gap-y-2 border-b border-slate-300 px-3 pt-2">
            <div role="tablist" aria-label="表示の切り替え" className="flex gap-1">
              {tabs.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === item.id}
                  onClick={() => setTab(item.id)}
                  className={clsx(
                    '-mb-px border-b-2 px-3 pb-2 pt-1.5 text-sm font-bold',
                    tab === item.id
                      ? 'border-slate-900 text-slate-900'
                      : 'border-transparent text-slate-600 hover:text-slate-900'
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-2 pb-2">
              {tab === 'devices' ? (
                <Input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="名前・ホスト名"
                  aria-label="端末を検索"
                  className="w-44 py-1 text-sm"
                />
              ) : null}
              {tab === 'logs' ? (
                <>
                  <select
                    value={logClientFilter}
                    onChange={(e) => setLogClientFilter(e.target.value)}
                    aria-label="ログのクライアント"
                    className={clsx(selectClassName, 'w-auto py-1')}
                  >
                    <option value="all">すべての端末</option>
                    {statusData.map((item) => (
                      <option key={item.clientId} value={item.clientId}>
                        {item.hostname || item.clientId}
                      </option>
                    ))}
                  </select>
                  <select
                    value={logLevelFilter}
                    onChange={(e) => setLogLevelFilter(e.target.value as 'ALL' | ClientLogLevel)}
                    aria-label="ログレベル"
                    className={clsx(selectClassName, 'w-auto py-1')}
                  >
                    <option value="ALL">全レベル</option>
                    <option value="ERROR">ERROR</option>
                    <option value="WARN">WARN</option>
                    <option value="INFO">INFO</option>
                    <option value="DEBUG">DEBUG</option>
                  </select>
                  <select
                    value={logLimit}
                    onChange={(e) => setLogLimit(Number(e.target.value))}
                    aria-label="取得件数"
                    className={clsx(selectClassName, 'w-auto py-1')}
                  >
                    {[50, 100, 200].map((limit) => (
                      <option key={limit} value={limit}>
                        {limit}件
                      </option>
                    ))}
                  </select>
                </>
              ) : null}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            {tab === 'devices' ? (
              clientsQuery.isError ? (
                <p className="p-4 text-sm font-semibold text-red-600">クライアント端末一覧の取得に失敗しました</p>
              ) : isLoading ? (
                <p className="p-4 text-sm text-slate-700">読み込み中...</p>
              ) : rows.length === 0 ? (
                <p className="p-4 text-sm text-slate-700">クライアント端末が登録されていません。</p>
              ) : visibleRows.length === 0 ? (
                <p className="p-4 text-sm text-slate-700">条件に合う端末はありません。</p>
              ) : (
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="text-left text-xs font-bold text-slate-700">
                      {['端末', '拠点', '起動先', 'CPU', '温度', '最終報告', '権限'].map((heading) => (
                        <th
                          key={heading}
                          className="sticky top-0 z-10 whitespace-nowrap border-b border-slate-300 bg-white px-3 py-2"
                        >
                          {heading}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((row) => {
                      const route = normalizeKioskInitialRoute(row.device?.kioskInitialRoute);
                      const isSelected = selected?.id === row.id;
                      return (
                        <tr
                          key={row.id}
                          onClick={() => selectRow(row.id)}
                          className={clsx(
                            'cursor-pointer border-b border-slate-300',
                            isSelected ? 'bg-emerald-50' : 'hover:bg-slate-100'
                          )}
                        >
                          <td className="px-3 py-2">
                            <button
                              type="button"
                              aria-current={isSelected ? 'true' : undefined}
                              className="flex items-center gap-2.5 text-left"
                            >
                              <StatusDot status={row.status} />
                              <span>
                                <span className="block text-sm font-bold text-slate-900">
                                  {row.device?.name ?? row.status?.hostname}
                                  {isRowDirty(row) ? (
                                    <span className="ml-2 rounded bg-emerald-600 px-1.5 py-0.5 text-xs font-bold text-white">
                                      未保存
                                    </span>
                                  ) : null}
                                </span>
                                <span className="block font-mono text-xs text-slate-600">
                                  {row.status?.hostname ?? row.device?.location ?? '-'}
                                </span>
                              </span>
                            </button>
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 font-semibold">
                            {!row.device ? (
                              <span className="text-slate-600">-</span>
                            ) : row.device.siteKey ? (
                              row.device.siteKey
                            ) : (
                              <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700">未設定</span>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2">
                            {!row.device ? (
                              <span className="text-xs font-semibold text-slate-600">台帳なし</span>
                            ) : route ? (
                              <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-900">
                                {KIOSK_INITIAL_ROUTE_LABELS[route]}
                              </span>
                            ) : (
                              <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">
                                {legacyModeLabel(row.device.defaultMode)}（旧設定）
                              </span>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 font-mono text-xs tabular-nums">
                            {row.status && !row.status.stale ? (
                              <span className="flex items-center gap-2">
                                <span className="w-12">
                                  <Meter value={row.status.cpuUsage} warnAt={65} dangerAt={85} />
                                </span>
                                {row.status.cpuUsage.toFixed(0)}%
                              </span>
                            ) : (
                              '-'
                            )}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 font-mono text-xs tabular-nums">
                            {row.status?.temperature != null && !row.status.stale
                              ? `${row.status.temperature.toFixed(0)}°C`
                              : '-'}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 font-mono text-xs tabular-nums text-slate-700">
                            {formatDateTime(row.status?.lastSeen ?? row.device?.lastSeenAt)}
                          </td>
                          <td className="px-3 py-2">
                            <span className="flex gap-1">
                              {(
                                [
                                  [row.device?.canProxyOtherDevices, '代理', '代理操作'],
                                  [row.device?.haizenEdgeEnabled, '配膳', 'Zero2W配膳'],
                                  [row.device?.shelfLayoutEditEnabled, '棚', '棚レイアウト編集']
                                ] as const
                              ).map(([enabled, short, title]) =>
                                enabled ? (
                                  <span
                                    key={short}
                                    title={title}
                                    className="rounded border border-slate-400 px-1.5 text-xs font-bold text-slate-700"
                                  >
                                    {short}
                                  </span>
                                ) : null
                              )}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )
            ) : null}

            {tab === 'logs' ? (
              logsQuery.isError ? (
                <p className="p-4 text-sm font-semibold text-red-600">ログの取得に失敗しました</p>
              ) : logsQuery.isLoading ? (
                <p className="p-4 text-sm text-slate-700">読み込み中...</p>
              ) : logsQuery.data && logsQuery.data.length > 0 ? (
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="text-left text-xs font-bold text-slate-700">
                      {['時刻 (JST)', '端末', 'レベル', 'メッセージ'].map((heading) => (
                        <th
                          key={heading}
                          className="sticky top-0 z-10 whitespace-nowrap border-b border-slate-300 bg-white px-3 py-2"
                        >
                          {heading}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {logsQuery.data.map((log) => (
                      <tr key={log.id ?? `${log.clientId}-${log.createdAt}`} className="border-b border-slate-300">
                        <td className="whitespace-nowrap px-3 py-2 align-top font-mono text-xs text-slate-700">
                          {formatDateTime(log.createdAt)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 align-top font-mono text-xs font-semibold">
                          {log.clientId}
                        </td>
                        <td className="px-3 py-2 align-top">
                          <LogLevelBadge level={log.level} />
                        </td>
                        <td className="px-3 py-2 font-semibold">{log.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="p-4 text-sm text-slate-700">表示できるログがありません。</p>
              )
            ) : null}

            {tab === 'sites' ? (
              <div className="max-w-lg space-y-4 p-4">
                {sitesQuery.isError ? (
                  <p className="text-sm font-semibold text-red-600">拠点一覧の取得に失敗しました</p>
                ) : (
                  <ul className="flex flex-wrap gap-2">
                    {sites.map((site) => (
                      <li
                        key={site.key}
                        className="rounded-md border-2 border-slate-300 px-3 py-1 text-sm font-semibold text-slate-900"
                      >
                        {site.displayName}
                        <span className="ml-2 font-mono text-xs text-slate-600">
                          {rows.filter((row) => row.device?.siteKey === site.key).length}台
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="space-y-1">
                  <div className="flex items-start gap-2">
                    <Input
                      value={newSiteKey}
                      onChange={(e) => setNewSiteKey(e.target.value)}
                      maxLength={50}
                      placeholder="例: 第1工場"
                      aria-label="新しい拠点名"
                    />
                    <Button
                      type="button"
                      onClick={handleCreateSite}
                      disabled={createSiteMutation.isPending}
                      className="shrink-0"
                    >
                      拠点を追加
                    </Button>
                  </div>
                  {siteError ? <p className="text-xs font-semibold text-red-600">{siteError}</p> : null}
                </div>
              </div>
            ) : null}
          </div>
        </section>

        <section
          aria-label="端末の設定"
          className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl bg-white text-slate-900 shadow-lg"
        >
          {!selected ? (
            <p className="p-4 text-sm text-slate-700">
              {isLoading ? '読み込み中...' : '一覧から端末を選んでください。'}
            </p>
          ) : (
            <>
              <div className="space-y-2 border-b border-slate-300 px-4 pb-3 pt-3">
                <div className="flex items-center gap-2">
                  {form ? (
                    <Input
                      value={form.name}
                      onChange={(e) => patchForm({ name: e.target.value })}
                      maxLength={MAX_CLIENT_NAME_LENGTH}
                      aria-label="クライアント名"
                      className={clsx(
                        '-ml-2 border-transparent px-2 py-1 text-lg font-bold hover:border-slate-300',
                        changedFields.includes('name') && changedClassName
                      )}
                    />
                  ) : (
                    <p className="flex-1 text-lg font-bold">{status?.hostname}</p>
                  )}
                  <span
                    className={clsx(
                      'shrink-0 rounded-full px-3 py-1 text-xs font-bold text-white',
                      !status ? 'bg-slate-500' : status.stale ? 'bg-red-600' : 'bg-emerald-600'
                    )}
                  >
                    {!status ? '未報告' : status.stale ? '12時間超オフライン' : 'オンライン'}
                  </span>
                </div>
                <p className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-xs text-slate-700">
                  {status ? (
                    <>
                      <span>{status.hostname}</span>
                      <span>{status.ipAddress}</span>
                      <span>稼働 {formatUptime(status.uptimeSeconds)}</span>
                    </>
                  ) : null}
                  {selectedDevice?.location ? <span>{selectedDevice.location}</span> : null}
                  <span>最終報告 {formatDateTime(status?.lastSeen ?? selectedDevice?.lastSeenAt)}</span>
                </p>
                {vitals.length > 0 ? (
                  <dl className="grid grid-cols-4 gap-2">
                    {vitals.map((vital) => (
                      <div key={vital.label}>
                        <dt className="text-xs font-semibold text-slate-700">{vital.label}</dt>
                        <dd className="text-lg font-bold tabular-nums">
                          {vital.value != null ? `${vital.value.toFixed(0)}${vital.unit}` : '-'}
                        </dd>
                        <Meter value={vital.value ?? 0} warnAt={vital.warnAt} dangerAt={vital.dangerAt} />
                      </div>
                    ))}
                  </dl>
                ) : null}
              </div>

              <div className="min-h-0 flex-1 space-y-4 overflow-auto px-4 py-3">
                {selectedDevice && form ? (
                  <>
                    <label className="block space-y-1">
                      <span className="text-xs font-bold text-slate-700">起動先</span>
                      <select
                        value={form.initialRoute}
                        onChange={(e) => patchForm({ initialRoute: e.target.value as EditableKioskInitialRoute })}
                        className={clsx(
                          selectClassName,
                          'border-slate-900 py-2.5 text-base',
                          changedFields.includes('initialRoute') && changedClassName
                        )}
                      >
                        <option value="">未設定（旧設定を使用）</option>
                        {form.initialRoute && !isKioskSelectableInitialRouteId(form.initialRoute) ? (
                          <option value={form.initialRoute}>
                            {KIOSK_INITIAL_ROUTE_LABELS[form.initialRoute]}（既存設定）
                          </option>
                        ) : null}
                        {KIOSK_SELECTABLE_INITIAL_ROUTE_IDS.map((routeId) => (
                          <option key={routeId} value={routeId}>
                            {KIOSK_INITIAL_ROUTE_LABELS[routeId]}
                          </option>
                        ))}
                      </select>
                    </label>
                    {form.initialRoute === '' ? (
                      <select
                        value={form.mode}
                        onChange={(e) => patchForm({ mode: e.target.value as 'PHOTO' | 'TAG' })}
                        aria-label="未設定時の旧初期表示"
                        className={clsx(selectClassName, '!mt-2', changedFields.includes('mode') && changedClassName)}
                      >
                        <option value="TAG">旧設定: 2タグスキャン</option>
                        <option value="PHOTO">旧設定: 写真撮影持出</option>
                      </select>
                    ) : null}

                    <div className="space-y-1">
                      <div className="flex items-end gap-2">
                        <label className="block min-w-0 flex-1 space-y-1">
                          <span className="text-xs font-bold text-slate-700">拠点</span>
                          <select
                            value={form.siteKey}
                            onChange={(e) => patchForm({ siteKey: e.target.value })}
                            className={clsx(selectClassName, changedFields.includes('siteKey') && changedClassName)}
                          >
                            <option value="">未設定</option>
                            {sites.map((site) => (
                              <option key={site.key} value={site.key}>
                                {site.displayName}
                              </option>
                            ))}
                          </select>
                        </label>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => setTab('sites')}
                          className="shrink-0 border-2 border-slate-300 text-sm"
                        >
                          新しい拠点
                        </Button>
                      </div>
                      {form.siteKey === '' ? (
                        <p className="text-xs font-semibold text-red-600">未設定だと製番ボードなどを開けません</p>
                      ) : null}
                    </div>

                    <div>
                      <Switch
                        label="代理操作"
                        ariaLabel="他端末の代理操作を許可"
                        checked={form.proxy}
                        onChange={(proxy) => patchForm({ proxy })}
                      />
                      <Switch
                        label="Zero2W配膳"
                        ariaLabel="Zero2W配膳エッジ端末として扱う"
                        checked={form.haizenEdge}
                        onChange={(haizenEdge) => patchForm({ haizenEdge })}
                      />
                      <Switch
                        label="棚レイアウト編集"
                        ariaLabel="棚レイアウト編集を許可"
                        checked={form.shelfLayout}
                        onChange={(shelfLayout) => patchForm({ shelfLayout })}
                      />
                    </div>

                    <div className="space-y-1">
                      <p className="text-xs font-bold text-slate-700">APIキー</p>
                      <div className="flex items-center gap-2">
                        <code className="min-w-0 flex-1 truncate rounded-md bg-slate-100 px-2 py-1.5 font-mono text-xs font-semibold">
                          {selectedDevice.apiKey}
                        </code>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => handleCopyApiKey(selectedDevice)}
                          className="shrink-0 border-2 border-slate-300 px-3 py-1 text-xs"
                        >
                          {copiedId === selectedDevice.id ? 'コピー済み' : 'コピー'}
                        </Button>
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="text-sm font-semibold text-slate-700">台帳にない端末です（稼働状況のみ）。</p>
                )}

                <div className="space-y-1">
                  <p className="text-xs font-bold text-slate-700">最新ログ</p>
                  {status && status.latestLogs.length > 0 ? (
                    <ul className="space-y-1">
                      {status.latestLogs.slice(0, 3).map((log, index) => (
                        <li key={`${log.createdAt}-${index}`} className="flex items-start gap-2 text-xs">
                          <LogLevelBadge level={log.level} />
                          <span className="flex-1 font-semibold">{log.message}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-slate-700">ログはありません</p>
                  )}
                  {status ? (
                    <button
                      type="button"
                      onClick={() => {
                        setLogClientFilter(status.clientId);
                        setTab('logs');
                      }}
                      className="text-xs font-bold text-emerald-700 underline underline-offset-2"
                    >
                      この端末のログをすべて見る
                    </button>
                  ) : null}
                </div>
              </div>

              {selectedDevice && form && savedForm ? (
                <div
                  className={clsx(
                    'flex items-center gap-2 border-t px-4 py-2.5',
                    isDirty ? 'border-emerald-600 bg-emerald-50' : 'border-slate-300'
                  )}
                >
                  <div className="min-w-0 flex-1 text-xs" role="status">
                    {editError ? (
                      <p className="font-semibold text-red-600">{editError}</p>
                    ) : isDirty ? (
                      <ul className="font-semibold text-emerald-800">
                        {changedFields.map((field) => (
                          <li key={field} className="truncate">
                            {FORM_FIELD_LABELS[field]}: <s className="font-normal text-slate-600">{formValueLabel(field, savedForm)}</s>{' '}
                            → {formValueLabel(field, form)}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-slate-700">{savedId === selectedDevice.id ? '保存しました' : '変更はありません'}</p>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => discardDraft(selectedDevice.id)}
                    disabled={!isDirty || update.isPending}
                    className="shrink-0 border-2 border-slate-300 px-3 py-1.5 text-sm"
                  >
                    元に戻す
                  </Button>
                  <Button
                    type="button"
                    onClick={handleSave}
                    disabled={!isDirty || update.isPending}
                    className="shrink-0 px-4 py-1.5 text-sm"
                  >
                    {update.isPending ? '保存中…' : '保存'}
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
