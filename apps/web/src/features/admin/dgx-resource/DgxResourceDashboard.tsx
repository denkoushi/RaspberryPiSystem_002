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

import { buildDgxResourceDashboardViewModel } from './dgxResourceDashboardViewModel';
import { DgxResourceEventsTimeline } from './DgxResourceEventsTimeline';
import { DgxResourceMonitoringPanel } from './DgxResourceMonitoringPanel';
import { DgxResourceOperatorConsole } from './DgxResourceOperatorConsole';
import { DgxResourcePolicyPanel } from './DgxResourcePolicyPanel';
import { DgxResourcePreflightPanel } from './DgxResourcePreflightPanel';
import { DgxResourceQuickProfileActions } from './DgxResourceQuickProfileActions';
import { DgxResourceSparkStatusPanel } from './DgxResourceSparkStatusPanel';
import { DgxResourceStatusBoard } from './DgxResourceStatusBoard';
import { DgxResourceTargetGrid } from './DgxResourceTargetGrid';
import { shouldShowMonitoringPanel } from './dgxResourceUi';
import { DgxResourceWarmRuntimeNotice } from './DgxResourceWarmRuntimeNotice';

import type {
  DgxControlTargetIdApi,
  DgxOrchestrationScenarioIdApi,
  DgxResourceActionBody,
  DgxResourceRuntimeSummaryApi,
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
      <div className="-mx-4 -my-6 flex min-h-[calc(100dvh-7.75rem)] flex-col gap-2 overflow-hidden px-4 py-2 text-base sm:-mx-6">
        <h1 className="text-2xl font-bold text-white">DGX リソース</h1>
        {overviewError ? <p className="text-sm text-red-300">{overviewError}</p> : null}
        <p className="text-sm text-white/60">{overviewQuery.isLoading ? '読み込み中…' : 'データなし'}</p>
      </div>
    );
  }

  const viewModel = buildDgxResourceDashboardViewModel(overview, { scenarioPending });
  const tabButtonClass = (tab: DetailTab) =>
    clsx(
      'rounded-md px-3 py-1.5 text-sm font-semibold transition',
      detailTab === tab
        ? 'bg-white text-slate-950'
        : 'border border-white/12 bg-white/[0.03] text-white/70 hover:bg-white/10 hover:text-white'
    );

  return (
    <div className="-mx-4 -my-6 flex min-h-[calc(100dvh-7.75rem)] flex-col gap-3 overflow-y-auto px-4 py-2 text-base sm:-mx-6">
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
        <section className="rounded-lg border border-amber-400/30 bg-amber-950/30 p-3">
          <h1 className="text-xl font-semibold text-white">DGX リソース</h1>
          <p className="mt-2 text-sm text-amber-100/90">
            API が運用者向け overview（operator）を返していません。Pi5 API を更新してください。
          </p>
        </section>
      )}

      <div className="space-y-1">
        {overviewError ? <p className="text-sm text-red-300">{overviewError}</p> : null}
        {actionError ? (
          <p className="text-sm font-medium text-red-300" role="alert">
            {actionError}
          </p>
        ) : null}
      </div>

      {scenarioPending ? (
        <p className="rounded-md border border-sky-400/35 bg-sky-500/10 px-3 py-2 text-sm text-sky-100" role="status">
          {businessReturnPreparing || businessReturnStoragePending ? (
            <>
              業務復帰中
              <span className="mx-2 text-white/30">/</span>
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

      <DgxResourceStatusBoard kpis={overview.kpis} runtimeSummary={overview.runtimeSummary} />

      <section className="space-y-3 border-t border-white/10 pt-3">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="DGX 詳細">
          <button
            type="button"
            role="tab"
            aria-selected={detailTab === 'state'}
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
                <div key={row.key} className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-2" title={row.hint}>
                  <div className="text-xs text-white/45">{row.label}</div>
                  <div className="mt-1 truncate text-sm font-semibold text-white">{row.value}</div>
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
              <div className="space-y-1 text-xs text-white/45">
                {overview.notes.map((line) => (
                  <div key={line}>{line}</div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
