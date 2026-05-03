import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';

import { dgxResourceQueryKeys, getDgxResourceApiErrorMessage } from '../../../api/dgx-resource';
import { Button } from '../../../components/ui/Button';
import { useConfirm } from '../../../contexts/ConfirmContext';

import type {
  DgxOrchestrationScenarioIdApi,
  DgxResourceActionBody,
  DgxResourceActionResult,
  DgxResourceOperatorConsoleApi,
  DgxResourceOverview,
  DgxResourceScenarioExecuteResultApi,
  DgxServiceStatusKind,
  ScenarioPlanPreviewApi,
} from '../../../api/dgx-resource.types';

function formatStepsForConfirm(preview: ScenarioPlanPreviewApi): string {
  return preview.steps.map((s) => `${s.order}. ${s.summaryJa}`).join('\n');
}

function workloadRiskStripe(risk: DgxResourceOperatorConsoleApi['workloads'][0]['risk']): string {
  switch (risk) {
    case 'high':
      return 'border-red-400/45 bg-red-950/35';
    case 'medium':
      return 'border-amber-400/40 bg-amber-950/30';
    default:
      return 'border-emerald-400/35 bg-emerald-950/25';
  }
}

function statusBadgeClass(status: DgxServiceStatusKind): string {
  switch (status) {
    case 'running':
      return 'bg-emerald-500/20 text-emerald-100 border-emerald-400/40';
    case 'degraded':
      return 'bg-amber-500/20 text-amber-100 border-amber-400/40';
    case 'stopped':
      return 'bg-red-500/15 text-red-100 border-red-400/35';
    default:
      return 'bg-white/10 text-white/65 border-white/20';
  }
}

type Props = {
  overview: DgxResourceOverview;
  operator: DgxResourceOperatorConsoleApi;
  postDgxAction: (body: DgxResourceActionBody) => Promise<DgxResourceActionResult>;
  actionBusy: boolean;
  onControlUiError: (message: string | null) => void;
};

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

  const summary = operator.operatorSummary;
  const scenarioIdForPreview = selectedScenarioId;

  return (
    <section className="flex min-h-0 flex-col gap-2.5 rounded-xl border border-cyan-400/30 bg-gradient-to-br from-slate-950/80 to-cyan-950/25 p-3 shadow-lg shadow-black/20">
      <header className="shrink-0 space-y-1">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h2 className="text-lg font-bold text-cyan-50/95">運用コンソール</h2>
          <span className="font-mono text-xs text-white/40">{new Date(overview.generatedAt).toLocaleTimeString('ja-JP')}</span>
        </div>
        <p className="text-base font-medium leading-snug text-white/88">{summary.headlineJa}</p>
        {summary.inferenceSparkLineJa ? (
          <p className="line-clamp-2 text-sm text-cyan-100/80" title={summary.inferenceSparkLineJa}>
            {summary.inferenceSparkLineJa}
          </p>
        ) : null}
        {summary.comfyStartBlockedHint ? (
          <p className="rounded border border-amber-400/35 bg-amber-950/35 px-2 py-1 text-xs text-amber-100/90">
            業務優先モードでは私用 ComfyUI の自動起動ヒントが抑止されています（意図どおり）。
          </p>
        ) : null}
        {summary.previousPolicyLabelJa ? (
          <p className="text-xs text-white/45">直前のプロファイル: {summary.previousPolicyLabelJa}</p>
        ) : null}
        {summary.alertPreviewJa.length > 0 ? (
          <ul className="list-inside list-disc text-xs text-amber-100/85">
            {summary.alertPreviewJa.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}
      </header>

      <div className="grid shrink-0 grid-cols-1 gap-2 sm:grid-cols-3">
        {operator.workloads.map((w) => (
          <div
            key={w.id}
            className={`flex min-h-[5.5rem] flex-col rounded-lg border px-2.5 py-2 ${workloadRiskStripe(w.risk)}`}
            title={w.purposeJa}
          >
            <div className="flex items-center justify-between gap-1">
              <span className="truncate text-sm font-bold text-white/95">{w.labelJa}</span>
              <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[11px] font-bold ${statusBadgeClass(w.status)}`}>
                {w.status}
              </span>
            </div>
            <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-white/70">{w.statusHeadlineJa}</p>
            {w.detailHintJa ? (
              <p className="mt-0.5 line-clamp-2 text-[11px] text-white/50">{w.detailHintJa}</p>
            ) : null}
          </div>
        ))}
      </div>

      <div className="min-h-0 shrink-0 space-y-2">
        <h3 className="text-sm font-semibold text-white/80">目的別ガイド（プレビュー→確定実行）</h3>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {operator.operatorActions.map((a) => {
            const selected = selectedScenarioId === a.scenarioId;
            const disabled = Boolean(a.disabledReasonJa) || busy;
            return (
              <div
                key={a.id}
                className={`rounded-lg border px-2 py-1.5 ${
                  a.primary ? 'border-cyan-400/40 bg-cyan-950/30' : 'border-white/12 bg-black/25'
                }`}
              >
                <Button
                  type="button"
                  variant={selected ? 'primary' : 'ghost'}
                  className={`h-auto w-full justify-start px-2 py-1.5 text-left text-sm ${selected ? '' : 'border border-white/10'}`}
                  disabled={disabled}
                  title={a.disabledReasonJa}
                  onClick={async () => {
                    if (a.disabledReasonJa) return;
                    setSelectedScenarioId(a.scenarioId);
                    setLastPreview(null);
                    setLastExecute(null);
                    setResultNote(null);
                    await runPreview(a.scenarioId);
                  }}
                >
                  <span className="block font-semibold">{a.labelJa}</span>
                  <span className="mt-0.5 block text-xs font-normal text-white/60">{a.subtitleJa}</span>
                  {a.disabledReasonJa ? (
                    <span className="mt-1 block text-xs text-amber-200/90">利用不可: {a.disabledReasonJa}</span>
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
            className="px-3 py-1.5 text-sm"
            disabled={busy || scenarioIdForPreview == null}
            onClick={() => {
              if (scenarioIdForPreview != null) void runPreview(scenarioIdForPreview);
            }}
          >
            プレビュー再取得
          </Button>
          <Button
            type="button"
            variant="primary"
            className="px-3 py-1.5 text-sm disabled:opacity-40"
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
        <div className="max-h-36 shrink-0 overflow-y-auto rounded border border-white/10 bg-black/35 p-2 text-xs text-white/75">
          <div className="font-mono text-[11px] text-cyan-200/95">
            Fingerprint: <span className="break-all">{lastPreview.planFingerprint.slice(0, 24)}…</span>
          </div>
          <ol className="mt-1.5 list-decimal space-y-0.5 pl-4 leading-snug">
            {lastPreview.steps.map((s) => (
              <li key={s.order}>{s.summaryJa}</li>
            ))}
          </ol>
          {lastPreview.warnings.length > 0 ? (
            <ul className="mt-1.5 list-none space-y-0.5 border-t border-white/10 pt-1.5 text-amber-100/90">
              {lastPreview.warnings.map((w) => (
                <li key={w}>⚠ {w}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {resultNote ? (
        <p className="shrink-0 text-sm text-cyan-100/90" role="status">
          {resultNote}
        </p>
      ) : null}

      {lastExecute ? (
        <div
          className={`max-h-28 shrink-0 overflow-y-auto rounded border p-2 text-xs ${
            lastExecute.detail.success ? 'border-emerald-500/35 bg-emerald-950/25' : 'border-amber-500/35 bg-amber-950/25'
          }`}
        >
          <div className="font-semibold text-white/92">
            {lastExecute.detail.success
              ? lastExecute.detail.outcomeKind === 'noop'
                ? '実行結果: 変更なし（noop）'
                : '実行結果: 成功'
              : '実行結果: 部分成功または失敗'}
          </div>
          <div className="mt-1 leading-snug text-white/78">{lastExecute.message}</div>
          <div className="mt-1 text-[11px] text-white/55">
            完了 step order: {lastExecute.detail.completedStepOrders.join(', ') || 'none'}
            {lastExecute.detail.outcomeKind ? ` · ${lastExecute.detail.outcomeKind}` : ''}
          </div>
          {lastExecute.detail.recommendedNextJa ? (
            <div className="mt-1 text-[11px] leading-snug text-white/65">次の確認: {lastExecute.detail.recommendedNextJa}</div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
