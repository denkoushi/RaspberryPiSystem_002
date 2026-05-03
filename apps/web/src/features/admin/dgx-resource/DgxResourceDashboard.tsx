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

import { DgxResourceAdvancedControls } from './DgxResourceAdvancedControls';
import { DgxResourceEventsTimeline } from './DgxResourceEventsTimeline';
import { DgxResourceKpiStrip } from './DgxResourceKpiStrip';
import { DgxResourceMonitoringPanel } from './DgxResourceMonitoringPanel';
import { DgxResourceOperatorConsole } from './DgxResourceOperatorConsole';
import { DgxResourcePolicyPanel } from './DgxResourcePolicyPanel';
import { DgxResourceSparkStatusPanel } from './DgxResourceSparkStatusPanel';
import { DgxResourceTargetGrid } from './DgxResourceTargetGrid';
import { shouldShowMonitoringPanel } from './dgxResourceUi';
import { DgxResourceWarmRuntimeNotice } from './DgxResourceWarmRuntimeNotice';

import type { DgxControlTargetIdApi, DgxResourceActionBody } from '../../../api/dgx-resource.types';

const EVENT_LIMIT = 12;

/** 運用者向け 1 画面優先。ページ縦スクロールを避け、詳細は内部スクロール。 */
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

  const postDgxActionAsync = (body: DgxResourceActionBody) => mutateAction.mutateAsync(body);

  const ovError =
    overviewQuery.error != null ? getDgxResourceApiErrorMessage(overviewQuery.error) : null;
  const evError = eventsQuery.error != null ? getDgxResourceApiErrorMessage(eventsQuery.error) : null;

  const overview = overviewQuery.data;
  const targets = overview?.targets ?? [];
  const operator = overview?.operator;
  const showMonitoringPanel = overview ? shouldShowMonitoringPanel(overview.monitoring) : false;

  return (
    <div className="-mx-4 -my-6 flex min-h-[calc(100dvh-7.75rem)] flex-col gap-2 overflow-hidden px-4 py-2 text-base sm:-mx-6">
      <header className="shrink-0">
        <h1 className="text-2xl font-bold text-white">DGX リソース</h1>
        <p className="text-sm text-white/55">
          日常的には「運用ガイド」の 4 操作だけを使ってください（自動更新 5 秒）。
        </p>
        {ovError ? <p className="mt-1 text-sm font-medium text-red-300">{ovError}</p> : null}
        {evError ? <p className="mt-1 text-sm text-amber-200/90">{evError}</p> : null}
        {actionError ? (
          <p className="mt-1 text-sm font-medium text-red-300" role="alert">
            {actionError}
          </p>
        ) : null}
      </header>

      {!overview ? (
        <p className="text-sm text-white/60">{overviewQuery.isLoading ? '読み込み中…' : 'データなし'}</p>
      ) : (
        <>
          <div className="shrink-0">
            <DgxResourceKpiStrip kpis={overview.kpis} />
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 lg:grid-cols-12 lg:gap-2">
            <div className="flex min-h-0 flex-col gap-2 lg:col-span-7 lg:overflow-hidden">
              {operator ? (
                <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
                  <DgxResourceOperatorConsole
                    overview={overview}
                    operator={operator}
                    postDgxAction={postDgxActionAsync}
                    actionBusy={mutateAction.isPending}
                    onControlUiError={(m) => {
                      setActionError(m);
                      if (m == null) setTargetActionError(null);
                    }}
                  />
                </div>
              ) : (
                <p className="rounded border border-amber-400/30 bg-amber-950/30 p-2 text-sm text-amber-100/90">
                  API が運用者向け overview（operator）を返していません。Pi5 API を更新してください。
                </p>
              )}

              <DgxResourceAdvancedControls summary="詳細・保守: サービス単位での起動・停止（技術 ID / Pi5 POST）">
                <div className="max-h-[40vh] min-h-0 overflow-y-auto">
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
                </div>
              </DgxResourceAdvancedControls>

              <footer className="max-h-16 shrink-0 overflow-y-auto text-xs leading-snug text-white/45">
                {overview.notes.map((line) => (
                  <div key={line} className="truncate" title={line}>
                    ※ {line}
                  </div>
                ))}
              </footer>
            </div>

            <aside className="flex min-h-0 flex-col gap-2 overflow-y-auto lg:col-span-5">
              <DgxResourceAdvancedControls summary="詳細・保守: Spark・監視・運用モードの手動切替">
                <div className="flex flex-col gap-2">
                  <DgxResourceSparkStatusPanel sparkHost={overview.sparkHost} />
                  {showMonitoringPanel ? (
                    <div className="max-h-[14rem] min-h-0 shrink-0 overflow-y-auto">
                      <DgxResourceMonitoringPanel monitoring={overview.monitoring} />
                    </div>
                  ) : null}
                  <DgxResourcePolicyPanel
                    overview={overview}
                    onControlUiError={setActionError}
                    postDgxAction={postDgxActionAsync}
                    actionBusy={mutateAction.isPending}
                  />
                </div>
              </DgxResourceAdvancedControls>
              <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-white/10 bg-slate-900/40 px-2 py-2">
                <DgxResourceEventsTimeline events={eventsQuery.data?.events ?? []} />
              </div>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
