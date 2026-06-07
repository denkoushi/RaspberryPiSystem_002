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

import { DgxResourcePolicyPanel } from './DgxResourcePolicyPanel';
import { DgxResourcePrimaryScenarioFlow } from './DgxResourcePrimaryScenarioFlow';
import { DgxResourceQuickProfileActions } from './DgxResourceQuickProfileActions';
import { DgxResourceSparkStatusPanel } from './DgxResourceSparkStatusPanel';
import { DgxResourceStatusBoard } from './DgxResourceStatusBoard';
import { DgxResourceTargetGrid } from './DgxResourceTargetGrid';
import { DgxResourceWarmRuntimeNotice } from './DgxResourceWarmRuntimeNotice';

import type { DgxControlTargetIdApi, DgxResourceActionBody, DgxServiceStatusKind } from '../../../api/dgx-resource.types';

function statusChipTone(status: DgxServiceStatusKind): string {
  switch (status) {
    case 'running':
      return 'border-emerald-400/45 bg-emerald-950/25 text-emerald-100';
    case 'degraded':
      return 'border-amber-400/45 bg-amber-950/25 text-amber-100';
    case 'stopped':
      return 'border-white/20 bg-white/5 text-white/55';
    case 'unknown':
    default:
      return 'border-white/15 bg-black/25 text-white/45';
  }
}

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

function readPendingScenarioFromStorage(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = window.sessionStorage.getItem(DGX_SCENARIO_PENDING_STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { pending?: boolean; startedAt?: number } | null;
    if (!parsed?.pending || typeof parsed.startedAt !== 'number') return false;
    return Date.now() - parsed.startedAt <= 20 * 60 * 1000;
  } catch {
    return false;
  }
}

/** 通常画面は最小表示（状態 + 4操作 + 実行結果）。詳細は折りたたみへ退避。 */
export function DgxResourceDashboard() {
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const [targetActionError, setTargetActionError] = useState<{ targetId: DgxControlTargetIdApi; message: string } | null>(null);
  const [pendingFromStorage, setPendingFromStorage] = useState<boolean>(() => readPendingScenarioFromStorage());

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
  const scenarioLikelyRunning = isDgxScenarioLikelyRunning(events.map((e) => e.message));
  const runningScenario = deriveDgxRunningScenario(events);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setPendingFromStorage(readPendingScenarioFromStorage());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  if (!overview) {
    return (
      <div className="-mx-4 -my-6 flex min-h-[calc(100dvh-7.75rem)] flex-col gap-2 overflow-hidden px-4 py-2 text-base sm:-mx-6">
        <h1 className="text-2xl font-bold text-white">DGX リソース</h1>
        {overviewError ? <p className="text-sm text-red-300">{overviewError}</p> : null}
        <p className="text-sm text-white/60">{overviewQuery.isLoading ? '読み込み中…' : 'データなし'}</p>
      </div>
    );
  }

  const targetById = new Map((overview.targets ?? []).map((t) => [t.id, t]));
  const businessStatus = targetById.get('system-prod-inference')?.status ?? 'unknown';
  const comfyStatus = targetById.get('private-comfyui')?.status ?? 'unknown';
  const experimentStatus = targetById.get('experiment-lab')?.status ?? 'unknown';
  return (
    <div className="-mx-4 -my-6 flex min-h-[calc(100dvh-7.75rem)] flex-col gap-3 overflow-y-auto px-4 py-2 text-base sm:-mx-6">
      <header className="space-y-1">
        {overviewError ? <p className="text-sm text-red-300">{overviewError}</p> : null}
        {actionError ? (
          <p className="text-sm font-medium text-red-300" role="alert">
            {actionError}
          </p>
        ) : null}
      </header>

      <DgxResourceStatusBoard kpis={overview.kpis} runtimeSummary={overview.runtimeSummary} />

      <section className="flex flex-wrap gap-2">
        <div className={clsx('rounded-full border px-3 py-1.5 text-sm font-semibold', statusChipTone(businessStatus))}>VLM 推論: {businessStatus}</div>
        <div className={clsx('rounded-full border px-3 py-1.5 text-sm font-semibold', statusChipTone(comfyStatus))}>ComfyUI: {comfyStatus}</div>
        <div className={clsx('rounded-full border px-3 py-1.5 text-sm font-semibold', statusChipTone(experimentStatus))}>実験: {experimentStatus}</div>
      </section>
      {runningScenario.running || scenarioLikelyRunning || pendingFromStorage ? (
        <p className="rounded-lg border border-cyan-400/35 bg-cyan-950/25 px-3 py-2 text-sm text-cyan-100" role="status">
          進行中:
          {runningScenario.running
            ? ` ${runningScenario.scenarioId}（Strict Ready確認中・開始から約${runningScenario.elapsedMinutes}分）`
            : ' 切替処理を確認中です（イベント反映待ち）'}
        </p>
      ) : null}

      {overview.operator ? (
        <section className="rounded-xl border border-cyan-400/25 bg-slate-950/65 p-3">
          <DgxResourcePrimaryScenarioFlow
            operator={overview.operator}
            modelProfiles={overview.modelProfiles}
            postDgxAction={postDgxActionAsync}
            actionBusy={mutateAction.isPending}
            externalBusy={scenarioLikelyRunning}
            onControlUiError={(message) => {
              setActionError(message);
              if (message == null) setTargetActionError(null);
            }}
          />
        </section>
      ) : (
        <p className="rounded border border-amber-400/30 bg-amber-950/30 p-3 text-sm text-amber-100/90">
          API が運用者向け overview（operator）を返していません。Pi5 API を更新してください。
        </p>
      )}

      <div className="rounded-lg border border-white/12 bg-black/20 p-2">
        <DgxResourceSparkStatusPanel sparkHost={overview.sparkHost} />
      </div>

      <details className="rounded-xl border border-white/12 bg-black/20">
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-white/65">詳細・保守（通常は不要）</summary>
        <div className="space-y-3 border-t border-white/10 px-3 py-3">
          <DgxResourceWarmRuntimeNotice overview={overview} />

          <DgxResourceQuickProfileActions
            modelProfiles={overview.modelProfiles}
            postDgxAction={postDgxActionAsync}
            actionBusy={mutateAction.isPending}
            externalBusy={scenarioLikelyRunning}
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

          <footer className="space-y-1 text-xs text-white/45">
            {overview.notes.map((line) => (
              <div key={line}>※ {line}</div>
            ))}
          </footer>
        </div>
      </details>
    </div>
  );
}
