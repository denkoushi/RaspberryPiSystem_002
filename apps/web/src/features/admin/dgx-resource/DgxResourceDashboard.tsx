import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import {
  dgxResourceQueryKeys,
  fetchDgxResourceEvents,
  fetchDgxResourceOverview,
  getDgxResourceApiErrorMessage,
} from '../../../api/dgx-resource';
import { useConfirm } from '../../../contexts/ConfirmContext';

import { DgxResourceEventsTimeline } from './DgxResourceEventsTimeline';
import { DgxResourceKpiStrip } from './DgxResourceKpiStrip';
import { DgxResourcePolicyPanel } from './DgxResourcePolicyPanel';
import { DgxResourceServiceGrid } from './DgxResourceServiceGrid';
import { DgxResourceSparkStatusPanel } from './DgxResourceSparkStatusPanel';

const EVENT_LIMIT = 12;

/** スクロールなし一覧用の単一ブラウザチャート直下ビューポート高 */
export function DgxResourceDashboard() {
  const confirm = useConfirm();
  const [actionError, setActionError] = useState<string | null>(null);

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

  const ovError =
    overviewQuery.error != null ? getDgxResourceApiErrorMessage(overviewQuery.error) : null;
  const evError = eventsQuery.error != null ? getDgxResourceApiErrorMessage(eventsQuery.error) : null;

  return (
    <div className="-mx-4 -my-6 flex min-h-[calc(100dvh-7.75rem)] flex-col gap-2 overflow-hidden px-4 py-3 sm:-mx-6">
      <header className="shrink-0">
        <h1 className="text-lg font-bold text-white">DGX リソース</h1>
        <p className="text-[10px] text-white/60">
          Pi5 API 経由（/api/system/dgx-resource/*）。トークンはサーバのみ。自動更新 5 秒。
        </p>
        {ovError ? <p className="mt-1 text-xs font-medium text-red-300">{ovError}</p> : null}
        {evError ? <p className="mt-1 text-[11px] text-amber-200/90">{evError}</p> : null}
        {actionError ? (
          <p className="mt-1 text-xs font-medium text-red-300" role="alert">
            {actionError}
          </p>
        ) : null}
      </header>

      {!overviewQuery.data ? (
        <p className="text-xs text-white/60">{overviewQuery.isLoading ? '読み込み中…' : 'データなし'}</p>
      ) : (
        <>
          <DgxResourceKpiStrip kpis={overviewQuery.data.kpis} />

          <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 lg:grid-cols-12 lg:gap-3">
            <section className="flex min-h-0 flex-col gap-2 lg:col-span-8">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-xs font-semibold text-white/90">サービス</h2>
                <span className="font-mono text-[9px] text-white/40">
                  {new Date(overviewQuery.data.generatedAt).toLocaleTimeString('ja-JP')}
                </span>
              </div>
              <DgxResourceServiceGrid services={overviewQuery.data.services} />
              <footer className="shrink-0 text-[9px] leading-snug text-white/45">
                {overviewQuery.data.notes.map((line) => (
                  <div key={line} className="truncate">
                    ※ {line}
                  </div>
                ))}
                <div className="mt-1 truncate">
                  probes: metrics {overviewQuery.data.optionalProbes.metricsConfigured ? 'on' : 'off'} · comfy{' '}
                  {overviewQuery.data.optionalProbes.comfyHealthConfigured ? 'on' : 'off'} · emb{' '}
                  {overviewQuery.data.optionalProbes.embeddingHealthConfigured ? 'on' : 'off'} · spark{' '}
                  {overviewQuery.data.optionalProbes.sparkHostConfigured ? 'on' : 'off'}
                </div>
              </footer>
            </section>

            <aside className="flex min-h-0 shrink-0 flex-col gap-2 lg:col-span-4">
              <DgxResourceSparkStatusPanel sparkHost={overviewQuery.data.sparkHost} />
              <DgxResourcePolicyPanel
                overview={overviewQuery.data}
                onPolicyError={(m) => setActionError(m)}
                confirmStop={(opts) => confirm(opts)}
              />
              <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-white/10 bg-slate-900/40 px-2 py-2 lg:overflow-hidden">
                <DgxResourceEventsTimeline events={eventsQuery.data?.events ?? []} />
              </div>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
