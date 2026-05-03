import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { dgxResourceQueryKeys, getDgxResourceApiErrorMessage } from '../../../api/dgx-resource';
import { Button } from '../../../components/ui/Button';
import { useConfirm } from '../../../contexts/ConfirmContext';

import { orderPrimaryScenarioActions } from './dgxResourceTaskFlows';

import type {
  DgxOrchestrationScenarioIdApi,
  DgxResourceActionBody,
  DgxResourceActionResult,
  DgxResourceOperatorConsoleApi,
  DgxResourceScenarioExecuteResultApi,
  ScenarioPlanPreviewApi,
} from '../../../api/dgx-resource.types';

function formatStepsForConfirm(preview: ScenarioPlanPreviewApi): string {
  return preview.steps.map((s) => `${s.order}. ${s.summaryJa}`).join('\n');
}

type Props = {
  operator: DgxResourceOperatorConsoleApi;
  postDgxAction: (body: DgxResourceActionBody) => Promise<DgxResourceActionResult>;
  actionBusy: boolean;
  onControlUiError: (message: string | null) => void;
};

/** 4 つの目的別操作（プレビュー・実行）だけをまとめる */
export function DgxResourcePrimaryScenarioFlow({
  operator,
  postDgxAction,
  actionBusy,
  onControlUiError,
}: Props) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const primaryActionsOrdered = useMemo(
    () => orderPrimaryScenarioActions(operator.operatorActions),
    [operator.operatorActions]
  );

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
      primaryActionsOrdered.find((a) => a.primary && !a.disabledReasonJa)?.scenarioId ??
      primaryActionsOrdered.find((a) => !a.disabledReasonJa)?.scenarioId ??
      null;

    setSelectedScenarioId((prev) => {
      if (prev == null) return preferred;
      const current = primaryActionsOrdered.find((a) => a.scenarioId === prev);
      if (!current || current.disabledReasonJa) {
        return preferred;
      }
      return prev;
    });
  }, [primaryActionsOrdered]);

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
    <div className="min-h-0 shrink-0 space-y-3">
      <div>
        <h3 className="text-lg font-semibold text-white/95">いまやりたいこと（推奨）</h3>
        <p className="mt-0.5 text-sm text-white/55">
          ボタンを選ぶ → 「{previewButtonLabel}」でステップ確認 → 「この内容で実行する」まで進めます。
        </p>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {primaryActionsOrdered.map((a) => {
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
                  <span className="mt-1.5 block text-sm text-amber-100/95">現在は実行できません: {a.disabledReasonJa}</span>
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
              title: '運用ガイドの実行',
              description: [
                `種別（内部キー）: ${preview.scenarioId}`,
                `実行計画 ID（先頭 16 文字）: ${preview.planFingerprint.slice(0, 16)}…`,
                '',
                '進むステップ:',
                formatStepsForConfirm(preview),
                '',
                preview.warnings.length > 0 ? ['確認事項:', ...preview.warnings.map((w) => `・${w}`), ''].join('\n') : '',
              ].join('\n'),
              tone: preview.warnings.length > 2 ? 'danger' : 'primary',
            });
            if (!ok) return;
            await runExecute(preview);
          }}
        >
          この内容で実行する
        </Button>
      </div>

      {lastPreview && lastPreview.scenarioId === scenarioIdForPreview ? (
        <div className="max-h-40 shrink-0 overflow-y-auto rounded-xl border border-white/12 bg-black/40 p-3 text-sm text-white/80">
          <div className="font-mono text-xs text-cyan-200/95 sm:text-sm">
            実行計画 ID（指紋）: <span className="break-all">{lastPreview.planFingerprint.slice(0, 24)}…</span>
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
    </div>
  );
}
