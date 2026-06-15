import clsx from 'clsx';

import { formatUnifiedMemDisplay } from './dgxResourceKpiStripModel';
import { DgxResourcePrimaryScenarioFlow } from './DgxResourcePrimaryScenarioFlow';
import { serviceStatusDotTokens } from './dgxResourceUi';

import type {
  DgxResourceActionBody,
  DgxResourceActionResult,
  DgxOperatorWorkloadApi,
  DgxResourceOperatorConsoleApi,
  DgxResourceOverview,
  DgxServiceStatusKind,
} from '../../../api/dgx-resource.types';

type Props = {
  overview: DgxResourceOverview;
  operator: DgxResourceOperatorConsoleApi;
  postDgxAction: (body: DgxResourceActionBody) => Promise<DgxResourceActionResult>;
  actionBusy: boolean;
  externalBusy?: boolean;
  onControlUiError: (message: string | null) => void;
};

function formatPct(value: number | null | undefined): string {
  return value == null ? '未取得' : `${Math.round(value)}%`;
}

function formatTemperature(value: number | null | undefined): string {
  return value == null ? '温度未取得' : `${Math.round(value)}℃`;
}

function formatPower(value: number | null | undefined): string {
  return value == null ? '電力未取得' : `${Math.round(value)}W`;
}

function statusLabel(status: DgxServiceStatusKind): string {
  switch (status) {
    case 'running':
      return 'Ready';
    case 'degraded':
      return '注意';
    case 'stopped':
      return 'Stopped';
    default:
      return 'Unknown';
  }
}

function statusBadgeClass(status: DgxServiceStatusKind): string {
  switch (status) {
    case 'running':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    case 'degraded':
      return 'border-amber-200 bg-amber-50 text-amber-700';
    case 'stopped':
      return 'border-slate-200 bg-slate-50 text-slate-600';
    default:
      return 'border-slate-200 bg-white text-slate-500';
  }
}

function ownerLabel(owner: string | null | undefined): string {
  switch (owner) {
    case 'business':
      return 'business';
    case 'private':
      return 'private';
    case 'experiment':
      return 'experiment';
    default:
      return 'unknown';
  }
}

function currentStateLabel(overview: DgxResourceOverview, operator: DgxResourceOperatorConsoleApi): string {
  const summary = overview.runtimeSummary;
  if (summary?.businessReady) return '業務 Ready';
  if (summary?.resourceOwner === 'business' && summary.resourceStateStatus === 'preparing') return '業務復帰中';
  return summary?.resourceOwnerLabelJa ?? operator.operatorSummary.policyLabelJa;
}

function workloadSortKey(workload: DgxOperatorWorkloadApi): number {
  switch (workload.id) {
    case 'business_vlm':
      return 0;
    case 'private_comfy':
      return 1;
    case 'agent_container':
      return 2;
    case 'experiment_lab':
      return 3;
    default:
      return 10;
  }
}

function compactWorkloadLabel(workload: DgxOperatorWorkloadApi): string {
  switch (workload.id) {
    case 'business_vlm':
      return '業務推論';
    case 'private_comfy':
      return 'ComfyUI';
    case 'agent_container':
      return 'Agent';
    case 'experiment_lab':
      return '実験ラボ';
    default:
      return workload.labelJa;
  }
}

export function DgxResourceOperatorConsole({
  overview,
  operator,
  postDgxAction,
  actionBusy,
  externalBusy = false,
  onControlUiError,
}: Props) {
  const runtime = overview.runtimeSummary;
  const kpis = overview.kpis;
  const alerts = overview.monitoring.alerts;
  const activeProfile =
    runtime?.activeProfileId != null
      ? overview.modelProfiles?.available.find((profile) => profile.id === runtime.activeProfileId)
      : undefined;
  const memoryText = formatUnifiedMemDisplay(kpis.unifiedMemoryUsedGiB, kpis.unifiedMemoryTotalGiB);
  const memoryPct =
    kpis.unifiedMemoryUsedGiB != null && kpis.unifiedMemoryTotalGiB != null && kpis.unifiedMemoryTotalGiB > 0
      ? Math.min(100, Math.max(0, (kpis.unifiedMemoryUsedGiB / kpis.unifiedMemoryTotalGiB) * 100))
      : null;
  const modelText = runtime?.activeProfileDisplayNameJa ?? runtime?.activeProfileId ?? '未ロード';
  const modelMeta = [runtime?.activeBackend, activeProfile?.runtimeProfile?.engine ?? activeProfile?.backend].filter(Boolean).join(' / ') || 'runtime 未取得';
  const generatedAt = new Date(overview.generatedAt).toLocaleString('ja-JP', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const workloads = [...operator.workloads].sort((a, b) => workloadSortKey(a) - workloadSortKey(b));

  return (
    <section className="flex min-h-0 flex-col gap-2">
      <header className="flex min-h-0 flex-wrap items-center justify-between gap-2 leading-none">
        <h1 className="text-xl font-semibold leading-none text-white">DGX リソース</h1>
        <time className="font-mono text-xs font-semibold leading-none text-white/45" dateTime={overview.generatedAt}>
          {generatedAt}
        </time>
      </header>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white text-slate-950 shadow-lg shadow-black/20" aria-label="DGX 状態と操作">
        <div className="grid grid-cols-1 divide-y divide-slate-200 md:grid-cols-2 md:divide-x md:divide-y-0 xl:grid-cols-[1.25fr_repeat(4,minmax(0,1fr))]">
          <div className="grid min-h-[5.25rem] content-center gap-1 px-4 py-3">
            <div className="text-xs font-bold uppercase text-slate-500">Current State</div>
            <div className={clsx('text-2xl font-bold leading-tight', runtime?.businessReady ? 'text-emerald-700' : 'text-slate-900')}>
              {currentStateLabel(overview, operator)}
            </div>
            <div className="truncate text-xs font-semibold text-slate-500">
              owner: {ownerLabel(runtime?.resourceOwner)} / policy: {operator.operatorSummary.policyLabelJa}
            </div>
          </div>

          <div className="grid min-h-[5.25rem] content-center gap-1 px-4 py-3">
            <div className="text-xs font-bold uppercase text-slate-500">Model</div>
            <div className="truncate text-lg font-bold leading-tight text-slate-900" title={modelText}>
              {modelText}
            </div>
            <div className="truncate text-xs font-semibold text-slate-500">{modelMeta}</div>
          </div>

          <div className="grid min-h-[5.25rem] content-center gap-1 px-4 py-3">
            <div className="text-xs font-bold uppercase text-slate-500">Memory</div>
            <div className="text-lg font-bold leading-tight text-slate-900">{memoryText}</div>
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden>
              <div className="h-full rounded-full bg-blue-600" style={{ width: `${memoryPct ?? 0}%` }} />
            </div>
          </div>

          <div className="grid min-h-[5.25rem] content-center gap-1 px-4 py-3">
            <div className="text-xs font-bold uppercase text-slate-500">GPU</div>
            <div className="text-lg font-bold leading-tight text-slate-900">{formatPct(kpis.gpuUtilPct)}</div>
            <div className="truncate text-xs font-semibold text-slate-500">
              {formatTemperature(kpis.gpuTemperatureC)} / {formatPower(kpis.gpuPowerDrawW)}
            </div>
          </div>

          <div className="grid min-h-[5.25rem] content-center gap-1 px-4 py-3 md:col-span-2 xl:col-span-1">
            <div className="text-xs font-bold uppercase text-slate-500">Alerts</div>
            <div className={clsx('text-lg font-bold leading-tight', alerts.length > 0 ? 'text-amber-700' : 'text-slate-900')}>
              {alerts.length > 0 ? `${alerts.length}件` : 'なし'}
            </div>
            <div className="truncate text-xs font-semibold text-slate-500" title={alerts.map((alert) => `${alert.title}: ${alert.detail}`).join('\n')}>
              {alerts[0]?.title ?? 'all checks normal'}
            </div>
          </div>
        </div>

        <div className="grid gap-4 border-t border-slate-200 p-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <DgxResourcePrimaryScenarioFlow
            operator={operator}
            modelProfiles={overview.modelProfiles}
            runtimeSummary={overview.runtimeSummary}
            postDgxAction={postDgxAction}
            actionBusy={actionBusy}
            externalBusy={externalBusy}
            onControlUiError={onControlUiError}
          />

          <div className="grid content-start gap-2 border-t border-slate-200 pt-3 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0" aria-label="補助状態">
            {workloads.map((workload) => (
              <div key={workload.id} className="flex min-h-8 items-center justify-between gap-3 text-sm font-semibold">
                <span className="inline-flex min-w-0 items-center gap-2 text-slate-600">
                  <span className={clsx('h-2 w-2 shrink-0 rounded-full', serviceStatusDotTokens(workload.status))} aria-hidden />
                  <span className="truncate">{compactWorkloadLabel(workload)}</span>
                </span>
                <span className={clsx('shrink-0 rounded-full border px-2.5 py-1 text-xs font-bold', statusBadgeClass(workload.status))}>
                  {statusLabel(workload.status)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
