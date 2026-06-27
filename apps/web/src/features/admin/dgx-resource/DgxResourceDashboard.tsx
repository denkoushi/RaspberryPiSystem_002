import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { useEffect, useState } from 'react';

import {
  dgxResourceQueryKeys,
  fetchDgxResourceEvents,
  fetchDgxResourceOverview,
  getDgxResourceApiErrorMessage,
  postDgxResourceAction,
} from '../../../api/dgx-resource';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { POLL_MS } from '../../../lib/admin-polling-intervals';

import { DgxResourceAdvancedControls } from './DgxResourceAdvancedControls';
import { buildDgxResourceDashboardViewModel } from './dgxResourceDashboardViewModel';
import { DgxResourceEventsTimeline } from './DgxResourceEventsTimeline';
import { DgxResourceMonitoringPanel } from './DgxResourceMonitoringPanel';
import { DgxResourceOperatorConsole } from './DgxResourceOperatorConsole';
import { DgxResourcePolicyPanel } from './DgxResourcePolicyPanel';
import { DgxResourcePreflightPanel } from './DgxResourcePreflightPanel';
import { DgxResourceQuickProfileActions } from './DgxResourceQuickProfileActions';
import { DgxResourceSparkStatusPanel } from './DgxResourceSparkStatusPanel';
import { DgxResourceTargetGrid } from './DgxResourceTargetGrid';
import { shouldShowMonitoringPanel } from './dgxResourceUi';
import { DgxResourceWarmRuntimeNotice } from './DgxResourceWarmRuntimeNotice';

import type {
  DgxBusinessModelProfileApi,
  DgxControlTargetIdApi,
  DgxControlTargetSnapshotApi,
  DgxOrchestrationScenarioIdApi,
  DgxResourceActionBody,
  DgxResourceEvent,
  DgxResourceRuntimeSummaryApi,
  DgxServiceStatusKind,
} from '../../../api/dgx-resource.types';

type DetailTab = 'state' | 'maintenance' | 'logs';

function isDgxScenarioLikelyRunning(eventMessages: string[]): boolean {
  for (const message of eventMessages) {
    if (message.includes('Strict Ready:') && message.includes('完了条件の確認を開始します')) {
      return true;
    }
    if (
      message.includes('Strict Ready を確認しました') ||
      message.includes('Strict Ready がタイムアウトしました') ||
      (message.includes('ガイド ') && message.includes('途中停止'))
    ) {
      return false;
    }
  }
  return false;
}

function deriveDgxRunningScenario(events: Array<{ at: string; message: string }>):
  | { running: false }
  | { running: true; scenarioId: string; startedAt: string; elapsedMinutes: number } {
  const startRegex = /Strict Ready: 「([^」]+)」完了条件の確認を開始します/;
  const terminalRegexes = [/Strict Ready を確認しました/, /Strict Ready がタイムアウトしました/, /ガイド .* が途中停止/];

  let startIndex = -1;
  let startMatch: RegExpMatchArray | null = null;
  for (let i = 0; i < events.length; i += 1) {
    const m = events[i]?.message.match(startRegex);
    if (m) {
      startIndex = i;
      startMatch = m;
      break;
    }
  }
  if (startIndex < 0 || !startMatch || !events[startIndex]?.at) {
    return { running: false };
  }
  for (let i = 0; i < startIndex; i += 1) {
    const msg = events[i]?.message ?? '';
    if (terminalRegexes.some((r) => r.test(msg))) {
      return { running: false };
    }
  }
  const startedAt = events[startIndex]!.at;
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 60000));
  return {
    running: true,
    scenarioId: startMatch[1] ?? 'unknown',
    startedAt,
    elapsedMinutes,
  };
}

const DGX_SCENARIO_PENDING_STORAGE_KEY = 'dgx-resource:primary-scenario-pending';

type DgxPersistedScenarioPendingState = {
  pending: true;
  startedAt: number;
  scenarioId: DgxOrchestrationScenarioIdApi | null;
};

function isBusinessReturnScenario(scenarioId: DgxOrchestrationScenarioIdApi | null | undefined): boolean {
  return scenarioId === 'private_to_business' || scenarioId === 'experiment_to_business';
}

function isBusinessReturnReady(summary?: DgxResourceRuntimeSummaryApi): boolean {
  return summary?.businessReady === true && summary.resourceOwner === 'business';
}

function isBusinessReturnPreparing(summary?: DgxResourceRuntimeSummaryApi): boolean {
  return summary?.resourceOwner === 'business' && summary.resourceStateStatus === 'preparing' && summary.businessReady === false;
}

function compactStatusLabel(status: DgxServiceStatusKind | undefined): string {
  switch (status) {
    case 'running':
      return 'Ready';
    case 'degraded':
      return '注意';
    case 'stopped':
      return 'Stopped';
    case 'unknown':
    case undefined:
    default:
      return 'Unknown';
  }
}

function detailDotClass(status: DgxServiceStatusKind | 'event' | undefined): string {
  switch (status) {
    case 'running':
      return 'bg-emerald-700';
    case 'degraded':
    case 'event':
      return 'bg-amber-500';
    case 'stopped':
      return 'bg-slate-400';
    default:
      return 'bg-slate-400';
  }
}

function profileRowSubtitle(profile: DgxBusinessModelProfileApi): string {
  return [
    profile.backend,
    profile.runtimeProfile?.engine,
    profile.declaredCapabilities?.includes('vision') ? 'vision' : null,
  ].filter(Boolean).join(' / ') || profile.servedAlias;
}

function selectProfileRows(profiles: DgxBusinessModelProfileApi[], activeProfileId?: string | null): DgxBusinessModelProfileApi[] {
  return [...profiles]
    .sort((a, b) => {
      const activeDelta = Number(b.id === activeProfileId) - Number(a.id === activeProfileId);
      if (activeDelta !== 0) return activeDelta;
      const recommendedDelta = Number(b.recommended) - Number(a.recommended);
      if (recommendedDelta !== 0) return recommendedDelta;
      return a.displayNameJa.localeCompare(b.displayNameJa, 'ja');
    });
}

function profileSummaryStatus(profileRows: DgxBusinessModelProfileApi[], activeProfileId?: string | null): string {
  if (profileRows.length === 0) return 'not loaded';
  return profileRows.some((profile) => profile.id === activeProfileId) ? 'active' : 'available';
}

function profileBadges(profile: DgxBusinessModelProfileApi, activeProfileId?: string | null): string[] {
  return [
    profile.id === activeProfileId ? 'active' : null,
    profile.recommended ? 'recommended' : null,
    profile.businessOrchestrationEligible !== false ? 'business' : 'manual',
    profile.status,
  ].filter((badge): badge is string => Boolean(badge));
}

function profileBadgeClass(badge: string): string {
  switch (badge) {
    case 'active':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    case 'recommended':
      return 'border-sky-200 bg-sky-50 text-sky-700';
    case 'business':
      return 'border-indigo-200 bg-indigo-50 text-indigo-700';
    case 'available':
      return 'border-slate-200 bg-white text-slate-600';
    case 'unavailable':
      return 'border-amber-200 bg-amber-50 text-amber-700';
    default:
      return 'border-slate-200 bg-slate-50 text-slate-500';
  }
}

function findTarget(
  targets: DgxControlTargetSnapshotApi[] | undefined,
  id: DgxControlTargetIdApi
): DgxControlTargetSnapshotApi | undefined {
  return targets?.find((target) => target.id === id);
}

function gatewayDetail(target: DgxControlTargetSnapshotApi | undefined): string {
  if (!target) return '未取得';
  return target.metaLines[0] ?? compactStatusLabel(target.status);
}

function sparkDetail(overview: { sparkHost: { status: DgxServiceStatusKind; httpStatus?: number; errorBrief?: string } }): string {
  if (overview.sparkHost.httpStatus != null) return `health ${overview.sparkHost.httpStatus}`;
  return overview.sparkHost.errorBrief ?? compactStatusLabel(overview.sparkHost.status);
}

function latestEventDetail(events: DgxResourceEvent[]): string {
  return events[0]?.message ?? '直近イベントなし';
}

function readPendingScenarioFromStorage(): DgxPersistedScenarioPendingState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(DGX_SCENARIO_PENDING_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { pending?: boolean; startedAt?: number } | null;
    if (!parsed?.pending || typeof parsed.startedAt !== 'number') return null;
    if (Date.now() - parsed.startedAt > 20 * 60 * 1000) {
      window.sessionStorage.removeItem(DGX_SCENARIO_PENDING_STORAGE_KEY);
      return null;
    }
    return {
      pending: true,
      startedAt: parsed.startedAt,
      scenarioId: isBusinessReturnScenario((parsed as { scenarioId?: unknown }).scenarioId as DgxOrchestrationScenarioIdApi)
        ? ((parsed as { scenarioId: DgxOrchestrationScenarioIdApi }).scenarioId)
        : null,
    };
  } catch {
    return null;
  }
}

/** 通常画面は最小表示（状態 + 4操作 + 実行結果）。詳細は折りたたみへ退避。 */
export function DgxResourceDashboard() {
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const [targetActionError, setTargetActionError] = useState<{ targetId: DgxControlTargetIdApi; message: string } | null>(null);
  const [pendingFromStorage, setPendingFromStorage] = useState<DgxPersistedScenarioPendingState | null>(() => readPendingScenarioFromStorage());
  const [detailTab, setDetailTab] = useState<DetailTab>('state');

  const overviewQuery = useQuery({
    queryKey: dgxResourceQueryKeys.overview,
    queryFn: fetchDgxResourceOverview,
    refetchInterval: POLL_MS.dgxResourceDashboardPrimary,
  });
  const eventsQuery = useQuery({
    queryKey: dgxResourceQueryKeys.events(24),
    queryFn: () => fetchDgxResourceEvents(24),
    refetchInterval: POLL_MS.dgxResourceDashboardPrimary,
  });

  const mutateAction = useMutation({
    mutationFn: postDgxResourceAction,
    onSuccess: async () => {
      setActionError(null);
      setTargetActionError(null);
      await qc.invalidateQueries({ queryKey: dgxResourceQueryKeys.overview });
    },
    onError: (e, variables) => {
      const message = getDgxResourceApiErrorMessage(e);
      if (variables.type === 'EXECUTE_TARGET_ACTION') {
        setTargetActionError({ targetId: variables.targetId, message });
        setActionError(null);
        return;
      }
      if (variables.type === 'START_MODEL_PROFILE') {
        setTargetActionError(null);
        setActionError(message);
        return;
      }
      setTargetActionError(null);
      setActionError(message);
    },
  });

  const postDgxActionAsync = (body: DgxResourceActionBody) => mutateAction.mutateAsync(body);
  const overviewError = overviewQuery.error != null ? getDgxResourceApiErrorMessage(overviewQuery.error) : null;
  const overview = overviewQuery.data;
  const events = eventsQuery.data?.events ?? [];
  const runtimeSummary = overview?.runtimeSummary;
  const businessReturnReadyNow = isBusinessReturnReady(runtimeSummary);
  const businessReturnPreparing = isBusinessReturnPreparing(runtimeSummary);
  const eventScenarioLikelyRunning = isDgxScenarioLikelyRunning(events.map((e) => e.message));
  const scenarioLikelyRunning = eventScenarioLikelyRunning && !businessReturnReadyNow;
  const runningScenario = deriveDgxRunningScenario(events);
  const pendingFromStorageActive = pendingFromStorage != null && !businessReturnReadyNow;
  const businessReturnStoragePending = isBusinessReturnScenario(pendingFromStorage?.scenarioId) && !businessReturnReadyNow;
  const scenarioPending = scenarioLikelyRunning || businessReturnPreparing || pendingFromStorageActive;

  useEffect(() => {
    const timer = window.setInterval(() => {
      setPendingFromStorage(readPendingScenarioFromStorage());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!businessReturnReadyNow || !isBusinessReturnScenario(pendingFromStorage?.scenarioId) || typeof window === 'undefined') return;
    window.sessionStorage.removeItem(DGX_SCENARIO_PENDING_STORAGE_KEY);
    setPendingFromStorage(null);
  }, [businessReturnReadyNow, pendingFromStorage?.scenarioId]);

  if (!overview) {
    return (
      <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-2 text-base">
        <h1 className="text-xl font-bold text-slate-950">DGX リソース</h1>
        {overviewError ? <p className="text-sm text-red-700">{overviewError}</p> : null}
        <p className="text-sm text-slate-500">{overviewQuery.isLoading ? '読み込み中…' : 'データなし'}</p>
      </div>
    );
  }

  const viewModel = buildDgxResourceDashboardViewModel(overview, { scenarioPending });
  const profileRows = selectProfileRows(overview.modelProfiles?.available ?? [], runtimeSummary?.activeProfileId);
  const profileStatus = profileSummaryStatus(profileRows, runtimeSummary?.activeProfileId);
  const gatewayTarget = findTarget(overview.targets, 'system-prod-gateway') ?? findTarget(overview.targets, 'system-prod-inference');
  const detailRows = [
    {
      key: 'gateway',
      label: 'Gateway',
      value: gatewayDetail(gatewayTarget),
      status: gatewayTarget?.status,
    },
    {
      key: 'spark-host',
      label: 'Spark Host',
      value: sparkDetail(overview),
      status: overview.sparkHost.status,
    },
    {
      key: 'logs',
      label: 'Logs',
      value: latestEventDetail(events),
      status: events.length > 0 ? 'event' as const : undefined,
    },
  ];
  const tabButtonClass = (tab: DetailTab) =>
    clsx(
      'rounded-md px-3 py-1.5 text-sm font-semibold transition',
      detailTab === tab
        ? 'bg-slate-950 text-white'
        : 'border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-950'
    );

  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-3 text-base">
      {overview.operator ? (
        <DgxResourceOperatorConsole
          overview={overview}
          operator={overview.operator}
          postDgxAction={postDgxActionAsync}
          actionBusy={mutateAction.isPending}
          externalBusy={scenarioPending}
          onControlUiError={(message) => {
            setActionError(message);
            if (message == null) setTargetActionError(null);
          }}
        />
      ) : (
        <section className="rounded-lg border border-amber-300 bg-amber-50 p-3">
          <h1 className="text-xl font-bold text-slate-950">DGX リソース</h1>
          <p className="mt-2 text-sm text-amber-800">
            API が運用者向け overview（operator）を返していません。Pi5 API を更新してください。
          </p>
        </section>
      )}

      <div className="space-y-1">
        {overviewError ? <p className="text-sm text-red-700">{overviewError}</p> : null}
        {actionError ? (
          <p className="text-sm font-semibold text-red-700" role="alert">
            {actionError}
          </p>
        ) : null}
      </div>

      {scenarioPending ? (
        <p className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-800" role="status">
          {businessReturnPreparing || businessReturnStoragePending ? (
            <>
              業務復帰中
              <span className="mx-2 text-sky-300">/</span>
              DGX 側でモデルをロードしています
            </>
          ) : (
            <>
              進行中:
              {runningScenario.running
                ? ` ${runningScenario.scenarioId}（Strict Ready確認中・開始から約${runningScenario.elapsedMinutes}分）`
                : ' 切替処理を確認中です（イベント反映待ち）'}
            </>
          )}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="overflow-hidden rounded-lg border border-slate-300 bg-white" aria-label="モデルプロファイル">
          <div className="flex min-h-12 items-center justify-between gap-3 border-b border-slate-200 px-4">
            <h2 className="text-sm font-bold text-slate-950">モデルプロファイル</h2>
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">
              {profileStatus}
            </span>
          </div>
          <div className="grid">
            {profileRows.length === 0 ? (
              <div className="grid min-h-11 items-center px-4 text-sm font-semibold text-slate-500">
                モデルプロファイル未取得
              </div>
            ) : (
              profileRows.map((profile) => {
                const active = profile.id === runtimeSummary?.activeProfileId;
                const subtitle = profileRowSubtitle(profile);
                const badges = profileBadges(profile, runtimeSummary?.activeProfileId);
                return (
                  <div
                    key={profile.id}
                    className="grid min-h-12 grid-cols-[minmax(130px,0.9fr)_minmax(0,1fr)_minmax(150px,auto)] items-center gap-3 border-b border-slate-200 px-4 py-2 text-sm font-semibold last:border-b-0 max-sm:grid-cols-1 max-sm:gap-1"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className={clsx('h-2 w-2 shrink-0 rounded-full', active ? 'bg-emerald-700' : 'bg-slate-400')} aria-hidden />
                      <span className="min-w-0 truncate text-slate-950" title={profile.displayNameJa}>{profile.displayNameJa}</span>
                    </div>
                    <span className="min-w-0 truncate text-slate-500" title={`${subtitle} / ${profile.id}`}>
                      {subtitle}
                    </span>
                    <div className="flex min-w-0 flex-wrap justify-end gap-1 max-sm:justify-start">
                      {badges.map((badge) => (
                        <span
                          key={`${profile.id}-${badge}`}
                          className={clsx('rounded-full border px-2 py-0.5 text-[11px] font-bold leading-tight', profileBadgeClass(badge))}
                        >
                          {badge}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        <section className="overflow-hidden rounded-lg border border-slate-300 bg-white" aria-label="詳細">
          <div className="flex min-h-12 items-center justify-between gap-3 border-b border-slate-200 px-4">
            <h2 className="text-sm font-bold text-slate-950">詳細</h2>
            <span className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-xs font-bold text-slate-700">
              {detailRows.length}
            </span>
          </div>
          <div className="grid">
            {detailRows.map((row) => (
              <div
                key={row.key}
                className="grid min-h-11 grid-cols-[minmax(120px,0.8fr)_minmax(0,1.2fr)_auto] items-center gap-3 border-b border-slate-200 px-4 text-sm font-semibold last:border-b-0"
              >
                <span className="text-slate-950">{row.label}</span>
                <span className="min-w-0 truncate text-slate-500" title={row.value}>{row.value}</span>
                <span className={clsx('h-2 w-2 rounded-full', detailDotClass(row.status))} aria-hidden />
              </div>
            ))}
          </div>
        </section>
      </div>

      <DgxResourceAdvancedControls summary="詳細・保守・ログ">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="DGX 詳細">
          <button
            type="button"
            role="tab"
            aria-selected={detailTab === 'state'}
            tabIndex={detailTab === 'state' ? 0 : -1}
            aria-controls="dgx-resource-state-tab"
            className={tabButtonClass('state')}
            onClick={() => setDetailTab('state')}
          >
            状態
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={detailTab === 'maintenance'}
            tabIndex={detailTab === 'maintenance' ? 0 : -1}
            aria-controls="dgx-resource-maintenance-tab"
            className={tabButtonClass('maintenance')}
            onClick={() => setDetailTab('maintenance')}
          >
            保守
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={detailTab === 'logs'}
            tabIndex={detailTab === 'logs' ? 0 : -1}
            aria-controls="dgx-resource-logs-tab"
            className={tabButtonClass('logs')}
            onClick={() => setDetailTab('logs')}
          >
            ログ
          </button>
        </div>

        {detailTab === 'state' ? (
          <div id="dgx-resource-state-tab" role="tabpanel" className="space-y-3">
            <DgxResourcePreflightPanel overview={overview} />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
              {viewModel.detailRows.map((row) => (
                <div key={row.key} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2" title={row.hint}>
                  <div className="text-xs text-slate-500">{row.label}</div>
                  <div className="mt-1 truncate text-sm font-semibold text-slate-950">{row.value}</div>
                </div>
              ))}
            </div>
            <DgxResourceSparkStatusPanel sparkHost={overview.sparkHost} />
            <DgxResourceWarmRuntimeNotice overview={overview} />
            {shouldShowMonitoringPanel(overview.monitoring) ? (
              <DgxResourceMonitoringPanel monitoring={overview.monitoring} />
            ) : null}
          </div>
        ) : null}

        {detailTab === 'maintenance' ? (
          <div id="dgx-resource-maintenance-tab" role="tabpanel" className="space-y-3">
            <DgxResourceQuickProfileActions
              modelProfiles={overview.modelProfiles}
              postDgxAction={postDgxActionAsync}
              actionBusy={mutateAction.isPending}
              externalBusy={scenarioPending}
              onControlUiError={(message) => {
                setActionError(message);
                if (message == null) setTargetActionError(null);
              }}
            />

            <DgxResourcePolicyPanel
              overview={overview}
              onControlUiError={setActionError}
              postDgxAction={postDgxActionAsync}
              actionBusy={mutateAction.isPending}
            />

            <DgxResourceTargetGrid
              targets={overview.targets ?? []}
              overview={overview}
              targetActionError={targetActionError}
              onControlUiError={(message) => {
                setTargetActionError(null);
                setActionError(message);
              }}
              confirmStop={(opts) => confirm(opts)}
              busy={mutateAction.isPending}
              onExecuteTarget={(targetId, action) => {
                setActionError(null);
                setTargetActionError(null);
                mutateAction.mutate({
                  type: 'EXECUTE_TARGET_ACTION',
                  targetId,
                  action,
                  reason: 'admin_dgx_resource_ui',
                });
              }}
            />
          </div>
        ) : null}

        {detailTab === 'logs' ? (
          <div id="dgx-resource-logs-tab" role="tabpanel" className="space-y-3">
            <DgxResourceEventsTimeline events={events} />
            {overview.notes.length > 0 ? (
              <div className="space-y-1 text-xs text-slate-500">
                {overview.notes.map((line) => (
                  <div key={line}>{line}</div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </DgxResourceAdvancedControls>
    </div>
  );
}
