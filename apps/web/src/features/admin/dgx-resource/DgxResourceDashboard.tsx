import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { useState } from 'react';

import { dgxResourceQueryKeys, fetchDgxResourceOverview, getDgxResourceApiErrorMessage, postDgxResourceAction } from '../../../api/dgx-resource';
import { useConfirm } from '../../../contexts/ConfirmContext';

import { DgxResourceKpiStrip } from './DgxResourceKpiStrip';
import { DgxResourcePolicyPanel } from './DgxResourcePolicyPanel';
import { DgxResourcePrimaryScenarioFlow } from './DgxResourcePrimaryScenarioFlow';
import { DGX_POLICY_PROFILES } from './dgxResourceProfiles';
import { DgxResourceSparkStatusPanel } from './DgxResourceSparkStatusPanel';
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

/** 通常画面は最小表示（状態 + 4操作 + 実行結果）。詳細は折りたたみへ退避。 */
export function DgxResourceDashboard() {
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const [targetActionError, setTargetActionError] = useState<{ targetId: DgxControlTargetIdApi; message: string } | null>(null);

  const overviewQuery = useQuery({
    queryKey: dgxResourceQueryKeys.overview,
    queryFn: fetchDgxResourceOverview,
    refetchInterval: 5000,
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
      setTargetActionError(null);
      setActionError(message);
    },
  });

  const postDgxActionAsync = (body: DgxResourceActionBody) => mutateAction.mutateAsync(body);
  const overviewError = overviewQuery.error != null ? getDgxResourceApiErrorMessage(overviewQuery.error) : null;
  const overview = overviewQuery.data;

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
  const policyLabel = DGX_POLICY_PROFILES[overview.policy.mode].titleShort;

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

      <DgxResourceKpiStrip kpis={overview.kpis} />

      <section className="flex flex-wrap gap-2">
        <div className="rounded-full border border-cyan-400/35 bg-cyan-950/20 px-3 py-1.5 text-sm font-semibold text-cyan-100">{policyLabel}</div>
        <div className={clsx('rounded-full border px-3 py-1.5 text-sm font-semibold', statusChipTone(businessStatus))}>VLM 推論: {businessStatus}</div>
        <div className={clsx('rounded-full border px-3 py-1.5 text-sm font-semibold', statusChipTone(comfyStatus))}>ComfyUI: {comfyStatus}</div>
        <div className={clsx('rounded-full border px-3 py-1.5 text-sm font-semibold', statusChipTone(experimentStatus))}>実験: {experimentStatus}</div>
      </section>

      {overview.operator ? (
        <section className="rounded-xl border border-cyan-400/25 bg-slate-950/65 p-3">
          <DgxResourcePrimaryScenarioFlow
            operator={overview.operator}
            postDgxAction={postDgxActionAsync}
            actionBusy={mutateAction.isPending}
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
