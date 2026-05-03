import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import {
  dgxResourceQueryKeys,
  fetchDgxResourceEvents,
  fetchDgxResourceOverview,
  getDgxResourceApiErrorMessage,
  postDgxResourceAction,
} from '../../../api/dgx-resource';
import { useConfirm } from '../../../contexts/ConfirmContext';

import { DgxResourceEventsTimeline } from './DgxResourceEventsTimeline';
import { DgxResourceKpiStrip } from './DgxResourceKpiStrip';
import { DgxResourceMonitoringPanel } from './DgxResourceMonitoringPanel';
import { DgxResourceOrchestrationPanel } from './DgxResourceOrchestrationPanel';
import { DgxResourcePolicyPanel } from './DgxResourcePolicyPanel';
import { DgxResourceSparkStatusPanel } from './DgxResourceSparkStatusPanel';
import { DgxResourceTargetGrid } from './DgxResourceTargetGrid';
import { DgxResourceWarmRuntimeNotice } from './DgxResourceWarmRuntimeNotice';

import type { DgxControlTargetIdApi } from '../../../api/dgx-resource.types';

const EVENT_LIMIT = 12;

/** スクロールなし一覧用の単一ブラウザチャート直下ビューポート高 */
export function DgxResourceDashboard() {
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const [targetActionError, setTargetActionError] = useState<{ targetId: DgxControlTargetIdApi; message: string } | null>(
    null
  );

  const overviewQuery = useQuery({
    queryKey: dgxResourceQueryKeys.overview,
    queryFn: fetchDgxResourceOverview,
    refetchInterval: 5000,
  });

  const eventsQuery = useQuery({
    queryKey: dgxResourceQueryKeys.events(EVENT_LIMIT),
    queryFn: () => fetchDgxResourceEvents(EVENT_LIMIT),
    refetchInterval: 5000,
  });

  const mutateAction = useMutation({
    mutationFn: postDgxResourceAction,
    onSuccess: async () => {
      setActionError(null);
      setTargetActionError(null);
      await Promise.all([
        qc.invalidateQueries({ queryKey: dgxResourceQueryKeys.overview }),
        qc.invalidateQueries({ queryKey: ['dgx-resource', 'events'] }),
      ]);
    },
    onError: (e, variables) => {
      const message = getDgxResourceApiErrorMessage(e);
      if (variables.type === 'EXECUTE_TARGET_ACTION') {
        setTargetActionError({ targetId: variables.targetId, message });
        setActionError(null);
        return;
      }
      setTargetActionError(null);
      setActionError(message);
    },
  });

  const ovError =
    overviewQuery.error != null ? getDgxResourceApiErrorMessage(overviewQuery.error) : null;
  const evError = eventsQuery.error != null ? getDgxResourceApiErrorMessage(eventsQuery.error) : null;

  const overview = overviewQuery.data;
  const targets = overview?.targets ?? [];

  return (
    <div className="-mx-4 -my-6 flex min-h-[calc(100dvh-7.75rem)] flex-col gap-3 overflow-hidden px-4 py-3 text-base sm:-mx-6">
      <header className="shrink-0">
        <h1 className="text-2xl font-bold text-white">DGX リソース</h1>
        <p className="text-base text-white/60">
          Pi5 API 経由（/api/system/dgx-resource/*）。Control Target を監視し、起停用 URL が Pi5 に設定されているターゲットは POST
          で起動・停止できます（gateway / 私用 ComfyUI / experiment-lab）。自動更新 5 秒。
        </p>
        {ovError ? <p className="mt-1 text-base font-medium text-red-300">{ovError}</p> : null}
        {evError ? <p className="mt-1 text-base text-amber-200/90">{evError}</p> : null}
        {actionError ? (
          <p className="mt-1 text-base font-medium text-red-300" role="alert">
            {actionError}
          </p>
        ) : null}
      </header>

      {!overview ? (
        <p className="text-sm text-white/60">{overviewQuery.isLoading ? '読み込み中…' : 'データなし'}</p>
      ) : (
        <>
          <DgxResourceKpiStrip kpis={overview.kpis} />

          <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 lg:grid-cols-12 lg:gap-3">
            <section className="flex min-h-0 flex-col gap-2 lg:col-span-8">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-lg font-semibold text-white/90">Control Targets</h2>
                <span className="font-mono text-sm text-white/40">
                  {new Date(overview.generatedAt).toLocaleTimeString('ja-JP')}
                </span>
              </div>
              <p className="text-sm text-white/45">
                読取のみのターゲットは状態表示のみ。<span className="font-mono text-white/55">capabilities</span> に起停があるカードのみボタン表示（DGX
                側に Pi5 から到達可能な POST hook を用意する）。
              </p>
              <DgxResourceWarmRuntimeNotice overview={overview} />
              <DgxResourceTargetGrid
                targets={targets}
                overview={overview}
                targetActionError={targetActionError}
                onControlUiError={(m) => {
                  setTargetActionError(null);
                  setActionError(m);
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
              <footer className="shrink-0 text-sm leading-snug text-white/45">
                {overview.notes.map((line) => (
                  <div key={line} className="truncate" title={line}>
                    ※ {line}
                  </div>
                ))}
                <div
                  className="mt-1 truncate"
                  title={`probes: metrics ${overview.optionalProbes.metricsConfigured ? 'on' : 'off'} · comfy ${overview.optionalProbes.comfyHealthConfigured ? 'on' : 'off'} · emb ${overview.optionalProbes.embeddingHealthConfigured ? 'on' : 'off'} · spark ${overview.optionalProbes.sparkHostConfigured ? 'on' : 'off'} · comfyRt ${overview.optionalProbes.comfyRuntimeControlConfigured ? 'on' : 'off'} · expLabHlth ${overview.optionalProbes.experimentLabHealthConfigured ? 'on' : 'off'} · expRt ${overview.optionalProbes.experimentLabRuntimeControlConfigured ? 'on' : 'off'}`}
                >
                  probes: metrics {overview.optionalProbes.metricsConfigured ? 'on' : 'off'} · comfy{' '}
                  {overview.optionalProbes.comfyHealthConfigured ? 'on' : 'off'} · emb{' '}
                  {overview.optionalProbes.embeddingHealthConfigured ? 'on' : 'off'} · spark{' '}
                  {overview.optionalProbes.sparkHostConfigured ? 'on' : 'off'} · comfyRt{' '}
                  {overview.optionalProbes.comfyRuntimeControlConfigured ? 'on' : 'off'} · expLab{' '}
                  {overview.optionalProbes.experimentLabRuntimeControlConfigured ? 'on' : 'off'}
                </div>
              </footer>
            </section>

            <aside className="flex min-h-0 shrink-0 flex-col gap-2 lg:col-span-4">
              <DgxResourceSparkStatusPanel sparkHost={overview.sparkHost} />
              <DgxResourceMonitoringPanel monitoring={overview.monitoring} />
              <DgxResourceOrchestrationPanel onControlUiError={(m) => setActionError(m)} />
              <DgxResourcePolicyPanel overview={overview} onControlUiError={(m) => setActionError(m)} />
              <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-white/10 bg-slate-900/40 px-3 py-3 lg:overflow-hidden">
                <DgxResourceEventsTimeline events={eventsQuery.data?.events ?? []} />
              </div>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
