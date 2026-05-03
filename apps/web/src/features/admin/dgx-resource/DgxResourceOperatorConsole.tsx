import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { useCallback, useEffect, useState } from 'react';

import { dgxResourceQueryKeys, getDgxResourceApiErrorMessage } from '../../../api/dgx-resource';
import { Button } from '../../../components/ui/Button';
import { useConfirm } from '../../../contexts/ConfirmContext';

import {
  policyModeBadgeTokens,
  serviceStatusDotTokens,
  statusBadgeTokens,
  workloadRiskCardTokens,
} from './dgxResourceUi';

import type {
  DgxOrchestrationScenarioIdApi,
  DgxResourceActionBody,
  DgxResourceActionResult,
  DgxResourceOperatorConsoleApi,
  DgxResourceOverview,
  DgxResourceScenarioExecuteResultApi,
  ScenarioPlanPreviewApi,
} from '../../../api/dgx-resource.types';

function formatStepsForConfirm(preview: ScenarioPlanPreviewApi): string {
  return preview.steps.map((s) => `${s.order}. ${s.summaryJa}`).join('\n');
}

type Props = {
  overview: DgxResourceOverview;
  operator: DgxResourceOperatorConsoleApi;
  postDgxAction: (body: DgxResourceActionBody) => Promise<DgxResourceActionResult>;
  actionBusy: boolean;
  onControlUiError: (message: string | null) => void;
};

function OperatorStatusBar({ overview, operator }: { overview: DgxResourceOverview; operator: DgxResourceOperatorConsoleApi }) {
  const summary = operator.operatorSummary;
  const mon = overview.monitoring;
  /** alertPreviewJa は monitoring.alerts 先頭の要約なので、件数は alerts のみ（二重計上しない） */
  const alertCount = mon.alerts.length;
  const business = operator.workloads.find((w) => w.id === 'business_vlm');
  const infDotStatus = business?.status ?? 'unknown';
  const statusTooltip = [summary.headlineJa, summary.inferenceSparkLineJa, ...summary.alertPreviewJa]
    .filter(Boolean)
    .join(' · ');

  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-lg border border-white/15 bg-black/35 px-2.5 py-2"
      role="status"
      aria-label="運用状態サマリ"
    >
      <span
        className={clsx('rounded-full px-3 py-1.5 text-sm font-bold tracking-tight', policyModeBadgeTokens(summary.policyMode))}
      >
        {summary.policyLabelJa}
      </span>
      <span
        className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 text-sm font-medium text-white/90"
        title={statusTooltip || '業務推論の状態'}
      >
        <span
          className={clsx('inline-block h-2.5 w-2.5 shrink-0 rounded-full', serviceStatusDotTokens(infDotStatus))}
          aria-hidden
        />
        業務推論
      </span>
      {alertCount > 0 ? (
        <span
          className="rounded-lg border border-amber-400/50 bg-amber-950/45 px-2.5 py-1.5 text-sm font-semibold text-amber-50"
          title={mon.alerts.map((a) => `${a.title}: ${a.detail}`).join('\n')}
        >
          注意 {alertCount}
        </span>
      ) : (
        <span className="rounded-lg border border-emerald-500/35 bg-emerald-950/30 px-2.5 py-1.5 text-sm font-medium text-emerald-100/95">
          注意なし
        </span>
      )}
      {summary.comfyStartBlockedHint ? (
        <span
          className="rounded-lg border border-amber-400/40 bg-amber-950/35 px-2 py-1 text-base leading-none"
          title="業務優先のため、私用 ComfyUI の起動抑止ヒントが有効です（仕様どおり）"
          aria-label="私用 Comfy 起動抑止ヒント"
        >
          🔒
        </span>
      ) : null}
      {summary.previousPolicyLabelJa ? (
        <span className="text-sm text-white/60" title={`直前のプロファイル: ${summary.previousPolicyLabelJa}`}>
          ↩ {summary.previousPolicyLabelJa}
        </span>
      ) : null}
      <span className="ml-auto font-mono text-sm text-white/45">{new Date(overview.generatedAt).toLocaleTimeString('ja-JP')}</span>
    </div>
  );
}

export function DgxResourceOperatorConsole({
  overview,
  operator,
  postDgxAction,
  actionBusy,
  onControlUiError,
}: Props) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [selectedScenarioId, setSelectedScenarioId] = useState<DgxOrchestrationScenarioIdApi | null>(null);
  const [lastPreview, setLastPreview] = useState<ScenarioPlanPreviewApi | null>(null);
  const [lastExecute, setLastExecute] = useState<{
    message: string;
    detail: DgxResourceScenarioExecuteResultApi;
  } | null>(null);
  const [resultNote, setResultNote] = useState<string | null>(null);
  const [flowBusy, setFlowBusy] = useState(false);

  const busy = actionBusy || flowBusy;

  const invalidateDgx = useCallback(async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: dgxResourceQueryKeys.overview }),
      qc.invalidateQueries({ queryKey: ['dgx-resource', 'events'] }),
    ]);
  }, [qc]);

  useEffect(() => {
    const preferred =
      operator.operatorActions.find((a) => a.primary && !a.disabledReasonJa)?.scenarioId ??
      operator.operatorActions.find((a) => !a.disabledReasonJa)?.scenarioId ??
      null;

    setSelectedScenarioId((prev) => {
      if (prev == null) return preferred;
      const current = operator.operatorActions.find((a) => a.scenarioId === prev);
      if (!current || current.disabledReasonJa) {
        return preferred;
      }
      return prev;
    });
  }, [operator]);

  const runPreview = async (scenarioId: DgxOrchestrationScenarioIdApi) => {
    setFlowBusy(true);
    setResultNote(null);
    setLastExecute(null);
    try {
      const data = await postDgxAction({ type: 'PREVIEW_ORCHESTRATION_SCENARIO', scenarioId });
      onControlUiError(null);
      if (data.scenarioPreview != null && data.scenarioPreview.scenarioId === scenarioId) {
        setLastPreview(data.scenarioPreview);
      } else {
        setLastPreview(null);
      }
      setResultNote(`プレビュー: ${data.message}`);
    } catch (e) {
      setLastPreview(null);
      onControlUiError(getDgxResourceApiErrorMessage(e));
    } finally {
      setFlowBusy(false);
    }
  };

  const runExecute = async (preview: ScenarioPlanPreviewApi) => {
    setFlowBusy(true);
    try {
      const data = await postDgxAction({
        type: 'EXECUTE_ORCHESTRATION_SCENARIO',
        scenarioId: preview.scenarioId,
        planFingerprint: preview.planFingerprint,
        confirmed: true,
      });
      onControlUiError(null);
      if (data.scenarioExecute != null) {
        setLastExecute({ message: data.message, detail: data.scenarioExecute });
      } else {
        setLastExecute(null);
      }
      if (data.scenarioExecute?.success === false && data.scenarioExecute.failureMessageJa) {
        setResultNote(`${data.message} — ${data.scenarioExecute.failureMessageJa}`);
      } else {
        setResultNote(data.message);
      }
      setLastPreview(null);
      await invalidateDgx();
    } catch (e) {
      onControlUiError(getDgxResourceApiErrorMessage(e));
    } finally {
      setFlowBusy(false);
    }
  };

  const scenarioIdForPreview = selectedScenarioId;
  const previewMatchesSelection = Boolean(lastPreview && lastPreview.scenarioId === scenarioIdForPreview);
  const previewButtonLabel = previewMatchesSelection ? 'プレビュー再取得' : 'プレビュー取得';

  return (
    <section className="flex min-h-0 flex-col gap-3 rounded-xl border border-cyan-400/30 bg-gradient-to-br from-slate-950/80 to-cyan-950/25 p-3 shadow-lg shadow-black/20">
      <header className="shrink-0 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-bold text-cyan-50/95">運用コンソール</h2>
        </div>
        <OperatorStatusBar overview={overview} operator={operator} />
      </header>

      <div className="grid shrink-0 grid-cols-1 gap-2 sm:grid-cols-3">
        {operator.workloads.map((w) => (
          <div
            key={w.id}
            className={clsx(
              'flex min-h-[6.75rem] flex-col rounded-xl border px-3 py-2.5',
              workloadRiskCardTokens(w.risk)
            )}
            title={[w.purposeJa, w.detailHintJa].filter(Boolean).join(' — ')}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-base font-bold text-white">{w.labelJa}</span>
              <span
                className={clsx('shrink-0 rounded-lg border px-2 py-0.5 text-xs font-bold uppercase', statusBadgeTokens(w.status))}
              >
                {w.status}
              </span>
            </div>
            <p className="mt-1.5 line-clamp-2 text-sm font-medium leading-snug text-white/85">{w.statusHeadlineJa}</p>
          </div>
        ))}
      </div>

      <div className="min-h-0 shrink-0 space-y-3">
        <h3 className="text-base font-semibold text-white/90">目的別ガイド</h3>
        <p className="text-sm text-white/55">シナリオを選んでから「{previewButtonLabel}」→ 内容確認後に実行してください。</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {operator.operatorActions.map((a) => {
            const selected = selectedScenarioId === a.scenarioId;
            const disabled = Boolean(a.disabledReasonJa) || busy;
            return (
              <div
                key={a.id}
                className={clsx(
                  'rounded-xl border px-2 py-2',
                  a.primary ? 'border-cyan-400/45 bg-cyan-950/35' : 'border-white/12 bg-black/30',
                  selected && 'ring-2 ring-cyan-400/55'
                )}
              >
                <Button
                  type="button"
                  variant={selected ? 'primary' : 'ghostOnDark'}
                  className="h-auto w-full justify-start px-2 py-2 text-left"
                  disabled={disabled}
                  title={a.disabledReasonJa}
                  onClick={() => {
                    if (a.disabledReasonJa) return;
                    setSelectedScenarioId(a.scenarioId);
                    setLastPreview(null);
                    setLastExecute(null);
                    setResultNote(null);
                  }}
                >
                  <span className="block text-base font-semibold">{a.labelJa}</span>
                  <span className="mt-1 block text-sm font-normal text-white/65">{a.subtitleJa}</span>
                  {a.disabledReasonJa ? (
                    <span className="mt-1.5 block text-sm text-amber-100/95">利用不可: {a.disabledReasonJa}</span>
                  ) : null}
                </Button>
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            className="px-4 py-2 text-base"
            disabled={busy || scenarioIdForPreview == null}
            onClick={() => {
              if (scenarioIdForPreview != null) void runPreview(scenarioIdForPreview);
            }}
          >
            {previewButtonLabel}
          </Button>
          <Button
            type="button"
            variant="primary"
            className="px-4 py-2 text-base disabled:opacity-40"
            disabled={!lastPreview || lastPreview.scenarioId !== scenarioIdForPreview || busy}
            onClick={async () => {
              if (!lastPreview || scenarioIdForPreview == null) return;
              const preview = lastPreview;
              const ok = await confirm({
                title: 'ガイド実行の確定',
                description: [
                  `シナリオ: ${preview.scenarioId}`,
                  `指紋（先頭16文字）: ${preview.planFingerprint.slice(0, 16)}…`,
                  '',
                  'ステップ一覧:',
                  formatStepsForConfirm(preview),
                  '',
                  preview.warnings.length > 0
                    ? ['警告:', ...preview.warnings.map((w) => `・${w}`), ''].join('\n')
                    : '',
                ].join('\n'),
                tone: preview.warnings.length > 2 ? 'danger' : 'primary',
              });
              if (!ok) return;
              await runExecute(preview);
            }}
          >
            指紋確認済みとして実行
          </Button>
        </div>
      </div>

      {lastPreview && lastPreview.scenarioId === scenarioIdForPreview ? (
        <div className="max-h-40 shrink-0 overflow-y-auto rounded-xl border border-white/12 bg-black/40 p-3 text-sm text-white/80">
          <div className="font-mono text-xs text-cyan-200/95 sm:text-sm">
            Fingerprint: <span className="break-all">{lastPreview.planFingerprint.slice(0, 24)}…</span>
          </div>
          <ol className="mt-2 list-decimal space-y-1 pl-5 leading-snug">
            {lastPreview.steps.map((s) => (
              <li key={s.order}>{s.summaryJa}</li>
            ))}
          </ol>
          {lastPreview.warnings.length > 0 ? (
            <ul className="mt-2 list-none space-y-1 border-t border-white/10 pt-2 text-sm text-amber-100/95">
              {lastPreview.warnings.map((w) => (
                <li key={w}>⚠ {w}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {resultNote ? (
        <p className="shrink-0 text-base text-cyan-100/90" role="status">
          {resultNote}
        </p>
      ) : null}

      {lastExecute ? (
        <div
          className={clsx(
            'max-h-32 shrink-0 overflow-y-auto rounded-xl border p-3 text-sm',
            lastExecute.detail.success ? 'border-emerald-500/40 bg-emerald-950/30' : 'border-amber-500/40 bg-amber-950/30'
          )}
        >
          <div className="text-base font-semibold text-white">
            {lastExecute.detail.success
              ? lastExecute.detail.outcomeKind === 'noop'
                ? '実行結果: 変更なし（noop）'
                : '実行結果: 成功'
              : '実行結果: 部分成功または失敗'}
          </div>
          <div className="mt-1.5 leading-snug text-white/85">{lastExecute.message}</div>
          <div className="mt-2 text-sm text-white/65">
            完了 step order: {lastExecute.detail.completedStepOrders.join(', ') || 'none'}
            {lastExecute.detail.outcomeKind ? ` · ${lastExecute.detail.outcomeKind}` : ''}
          </div>
          {lastExecute.detail.recommendedNextJa ? (
            <div className="mt-2 text-sm leading-snug text-white/75">次の確認: {lastExecute.detail.recommendedNextJa}</div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
