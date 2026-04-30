import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';

import {
  useKioskProductionScheduleLoadBalancingOverview,
  useKioskProductionScheduleManualOrderSiteDevices,
  usePostKioskProductionScheduleLoadBalancingSuggestions
} from '../../api/hooks';
import { isMacEnvironment } from '../../lib/client-key/resolver';

const MANUAL_ORDER_DEVICE_SCOPE_V2_ENABLED =
  import.meta.env.VITE_KIOSK_MANUAL_ORDER_DEVICE_SCOPE_V2_ENABLED !== 'false';
const PRODUCTION_SCHEDULE_MAC_TARGET_SITE_KEY = 'production-schedule-mac-target-site';
const PRODUCTION_SCHEDULE_MAC_TARGET_DEVICE_KEY = 'production-schedule-mac-target-device';
const DEFAULT_MAC_TARGET_SITES = ['第2工場', 'トークプラザ', '第1工場'] as const;

function defaultYearMonth(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function ProductionScheduleLoadBalancingPage() {
  const isMac =
    typeof window !== 'undefined' ? isMacEnvironment(window.navigator.userAgent) : false;
  const macManualOrderV2 = isMac && MANUAL_ORDER_DEVICE_SCOPE_V2_ENABLED;

  const [macTargetSite, setMacTargetSite] = useState<string>(() => {
    if (typeof window === 'undefined') return DEFAULT_MAC_TARGET_SITES[0];
    const stored = window.localStorage.getItem(PRODUCTION_SCHEDULE_MAC_TARGET_SITE_KEY)?.trim();
    return stored && stored.length > 0 ? stored : DEFAULT_MAC_TARGET_SITES[0];
  });
  const [macTargetDevice, setMacTargetDevice] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    return window.localStorage.getItem(PRODUCTION_SCHEDULE_MAC_TARGET_DEVICE_KEY)?.trim() ?? '';
  });

  const macSiteDevicesQuery = useKioskProductionScheduleManualOrderSiteDevices(
    macManualOrderV2 ? macTargetSite : undefined,
    { enabled: macManualOrderV2 }
  );

  useEffect(() => {
    if (!macManualOrderV2) return;
    const keys = macSiteDevicesQuery.data?.deviceScopeKeys ?? [];
    if (keys.length === 0) return;
    if (!macTargetDevice || !keys.includes(macTargetDevice)) {
      const next = keys[0] ?? '';
      setMacTargetDevice(next);
      if (typeof window !== 'undefined' && next) {
        window.localStorage.setItem(PRODUCTION_SCHEDULE_MAC_TARGET_DEVICE_KEY, next);
      }
    }
  }, [macManualOrderV2, macSiteDevicesQuery.data?.deviceScopeKeys, macTargetDevice]);

  const [month, setMonth] = useState(defaultYearMonth);

  const overviewParams = useMemo(() => {
    const base = { month: month.trim() };
    if (macManualOrderV2 && macTargetDevice.trim().length > 0) {
      return { ...base, targetDeviceScopeKey: macTargetDevice.trim() };
    }
    return base;
  }, [macManualOrderV2, macTargetDevice, month]);

  const overviewEnabled =
    /^\d{4}-\d{2}$/.test(month.trim()) && (!macManualOrderV2 || macTargetDevice.trim().length > 0);

  const overviewQuery = useKioskProductionScheduleLoadBalancingOverview(overviewParams, {
    enabled: overviewEnabled
  });

  const suggestionsMutation = usePostKioskProductionScheduleLoadBalancingSuggestions();

  useEffect(() => {
    suggestionsMutation.reset();
  }, [month, macManualOrderV2, macTargetDevice, suggestionsMutation]);

  const chartSlice = useMemo(() => {
    const rows = overviewQuery.data?.resources ?? [];
    const mapped = rows.map((r) => ({
      cd: r.resourceCd,
      req: Math.round(r.requiredMinutes),
      cap: r.availableMinutes == null ? 0 : Math.round(r.availableMinutes),
      capUnset: r.availableMinutes == null,
      over: Math.round(r.overMinutes),
      klass: r.classCode ?? ''
    }));
    return mapped.sort((a, b) => b.req - a.req).slice(0, 48);
  }, [overviewQuery.data?.resources]);

  const handleSuggest = async () => {
    await suggestionsMutation.mutateAsync({
      ...overviewParams,
      maxSuggestions: 40
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-auto p-1">
      <section className="rounded-lg border border-white/20 bg-slate-900/60 p-3 text-white">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <h2 className="text-sm font-semibold">負荷調整（山崩し支援）</h2>
            <p className="mt-1 max-w-3xl text-xs text-white/70">
              <code className="text-white/90">plannedEndDate</code>（受注補足）の月と一致する未完了工程を集計し、資源CD別の必要工数と能力を比較します。サジェストは工程行単位の移管候補のみです（自動適用しません）。
            </p>
          </div>
          <label className="flex flex-col gap-1 text-xs font-semibold text-white/90">
            対象月
            <input
              type="month"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
              className="rounded-md border border-white/30 bg-slate-950 px-2 py-1 text-white"
            />
          </label>
          <button
            type="button"
            className="rounded-md bg-sky-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
            disabled={!overviewEnabled || suggestionsMutation.isPending}
            onClick={() => void handleSuggest()}
          >
            {suggestionsMutation.isPending ? 'サジェスト計算中…' : 'サジェストを計算'}
          </button>
        </div>

        {macManualOrderV2 ? (
          <div className="mt-3 grid gap-2 rounded-md border border-white/15 bg-slate-950/40 p-3 text-xs text-white/80">
            <p className="font-semibold text-amber-200">Mac 代理参照（device scope v2）</p>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-white/70">工場サイト</span>
              <select
                value={macTargetSite}
                onChange={(event) => {
                  const next = event.target.value;
                  setMacTargetSite(next);
                  window.localStorage.setItem(PRODUCTION_SCHEDULE_MAC_TARGET_SITE_KEY, next);
                  window.localStorage.removeItem(PRODUCTION_SCHEDULE_MAC_TARGET_DEVICE_KEY);
                  setMacTargetDevice('');
                }}
                className="rounded-md border border-white/30 bg-slate-950 px-2 py-1 text-white"
              >
                {DEFAULT_MAC_TARGET_SITES.map((site) => (
                  <option key={site} value={site}>
                    {site}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-white/70">対象端末スコープ</span>
              <select
                value={macTargetDevice}
                onChange={(event) => {
                  const next = event.target.value;
                  setMacTargetDevice(next);
                  window.localStorage.setItem(PRODUCTION_SCHEDULE_MAC_TARGET_DEVICE_KEY, next);
                }}
                className="rounded-md border border-white/30 bg-slate-950 px-2 py-1 text-white"
              >
                {(macSiteDevicesQuery.data?.deviceScopeKeys ?? []).map((key) => (
                  <option key={key} value={key}>
                    {key}
                  </option>
                ))}
              </select>
            </label>
            {macTargetDevice.trim().length === 0 ? (
              <p className="text-[11px] font-semibold text-rose-200">対象端末スコープを選択してください。</p>
            ) : null}
          </div>
        ) : null}
      </section>

      {overviewQuery.error ? (
        <div className="rounded-md border border-rose-500/40 bg-rose-950/40 p-2 text-xs text-rose-100">
          読み込みエラー: {overviewQuery.error instanceof Error ? overviewQuery.error.message : String(overviewQuery.error)}
        </div>
      ) : null}

      {overviewQuery.isFetching ? (
        <p className="text-xs text-white/70">集計を読み込み中…</p>
      ) : null}

      {overviewQuery.data ? (
        <p className="text-[11px] text-white/60">
          siteKey: <span className="font-mono text-white/90">{overviewQuery.data.siteKey}</span> / yearMonth:{' '}
          <span className="font-mono text-white/90">{overviewQuery.data.yearMonth}</span>
        </p>
      ) : null}

      <section className="min-h-[260px] flex-1 rounded-lg border border-white/15 bg-slate-950/50 p-2">
        <p className="mb-2 text-xs font-semibold text-white">資源CD別（上位48・必要分降順）</p>
        {chartSlice.length === 0 ? (
          <p className="text-xs text-white/60">表示できるデータがありません（対象月・条件を確認してください）。</p>
        ) : (
          <div className="h-[280px] w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartSlice} margin={{ top: 8, right: 16, left: 0, bottom: 48 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="cd" angle={-35} textAnchor="end" interval={0} height={70} tick={{ fill: '#e2e8f0', fontSize: 10 }} />
                <YAxis tick={{ fill: '#e2e8f0', fontSize: 10 }} />
                <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', fontSize: 11 }} />
                <Legend wrapperStyle={{ fontSize: 11, color: '#e2e8f0' }} />
                <Bar dataKey="req" name="必要分" fill="#38bdf8" />
                <Bar dataKey="cap" name="能力分" fill="#34d399" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-white/15 bg-slate-950/40 p-2">
        <p className="mb-2 text-xs font-semibold text-white">明細（全資源）</p>
        <div className="max-h-72 overflow-auto">
          <table className="w-full border-collapse text-left text-[11px] text-white/90">
            <thead className="sticky top-0 bg-slate-900">
              <tr className="border-b border-white/10">
                <th className="px-2 py-1">資源CD</th>
                <th className="px-2 py-1">必要分</th>
                <th className="px-2 py-1">能力分</th>
                <th className="px-2 py-1">超過</th>
                <th className="px-2 py-1">分類</th>
              </tr>
            </thead>
            <tbody>
              {(overviewQuery.data?.resources ?? []).map((r) => (
                <tr key={r.resourceCd} className="border-b border-white/5">
                  <td className="px-2 py-1 font-mono">{r.resourceCd}</td>
                  <td className="px-2 py-1">{Math.round(r.requiredMinutes)}</td>
                  <td className="px-2 py-1">{r.availableMinutes == null ? '—' : Math.round(r.availableMinutes)}</td>
                  <td className="px-2 py-1">{Math.round(r.overMinutes)}</td>
                  <td className="px-2 py-1">{r.classCode ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-white/15 bg-slate-950/40 p-2">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <p className="text-xs font-semibold text-white">サジェスト（工程行）</p>
          {suggestionsMutation.isError ? (
            <span className="text-[11px] text-rose-200">
              {suggestionsMutation.error instanceof Error ? suggestionsMutation.error.message : 'エラー'}
            </span>
          ) : null}
        </div>
        {(suggestionsMutation.data?.suggestions ?? []).length === 0 ? (
          <p className="text-xs text-white/60">
            「サジェストを計算」を押すと候補が表示されます（超過資源・分類・移管ルール・移管先余力に依存）。
          </p>
        ) : (
          <div className="max-h-96 overflow-auto">
            <table className="w-full border-collapse text-left text-[11px] text-white/90">
              <thead className="sticky top-0 bg-slate-900">
                <tr className="border-b border-white/10">
                  <th className="px-2 py-1">製番</th>
                  <th className="px-2 py-1">注文</th>
                  <th className="px-2 py-1">品番</th>
                  <th className="px-2 py-1">から→へ</th>
                  <th className="px-2 py-1">行分</th>
                  <th className="px-2 py-1">移管後超過(元)</th>
                  <th className="px-2 py-1">移管後超過(先)</th>
                  <th className="px-2 py-1">ルール</th>
                </tr>
              </thead>
              <tbody>
                {(suggestionsMutation.data?.suggestions ?? []).map((s) => (
                  <tr key={s.rowId} className="border-b border-white/5">
                    <td className="px-2 py-1 font-mono">{s.fseiban}</td>
                    <td className="px-2 py-1 font-mono">{s.productNo}</td>
                    <td className="px-2 py-1 font-mono">{s.fhincd}</td>
                    <td className="px-2 py-1 font-mono">
                      {s.resourceCdFrom}→{s.resourceCdTo}
                    </td>
                    <td className="px-2 py-1">{Math.round(s.rowMinutes)}</td>
                    <td className="px-2 py-1">{Math.round(s.simulatedSourceOverAfter)}</td>
                    <td className="px-2 py-1">{Math.round(s.simulatedDestinationOverAfter)}</td>
                    <td className="px-2 py-1 text-[10px] text-white/70">
                      {s.fromClassCode}→{s.toClassCode} / pri{s.rulePriority} / eff{s.efficiencyRatio}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
