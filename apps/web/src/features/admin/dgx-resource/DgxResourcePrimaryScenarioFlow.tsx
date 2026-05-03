import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { useEffect, useMemo, useState } from 'react';

import { dgxResourceQueryKeys, getDgxResourceApiErrorMessage } from '../../../api/dgx-resource';
import { Button } from '../../../components/ui/Button';
import { useConfirm } from '../../../contexts/ConfirmContext';

import { orderPrimaryScenarioActions } from './dgxResourceTaskFlows';

import type {
  DgxOperatorConsoleActionApi,
  DgxOrchestrationScenarioIdApi,
  DgxResourceActionBody,
  DgxResourceActionResult,
  DgxResourceOperatorConsoleApi,
} from '../../../api/dgx-resource.types';

type Props = {
  operator: DgxResourceOperatorConsoleApi;
  postDgxAction: (body: DgxResourceActionBody) => Promise<DgxResourceActionResult>;
  actionBusy: boolean;
  onControlUiError: (message: string | null) => void;
};

function scenarioIcon(scenarioId: DgxOrchestrationScenarioIdApi): string {
  switch (scenarioId) {
    case 'business_to_private':
      return '🎨';
    case 'private_to_business':
      return '💼';
    case 'business_to_experiment':
      return '🧪';
    case 'experiment_to_business':
      return '🔄';
    default:
      return '⚙️';
  }
}

/** 日常運用向け UI: 4操作を選んで、そのまま確認→実行。 */
export function DgxResourcePrimaryScenarioFlow({
  operator,
  postDgxAction,
  actionBusy,
  onControlUiError,
}: Props) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const actions = useMemo(() => orderPrimaryScenarioActions(operator.operatorActions), [operator.operatorActions]);
  const [selectedScenarioId, setSelectedScenarioId] = useState<DgxOrchestrationScenarioIdApi | null>(null);
  const [flowBusy, setFlowBusy] = useState(false);
  const [resultNote, setResultNote] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const busy = actionBusy || flowBusy;

  useEffect(() => {
    const preferred = actions.find((a) => a.primary && !a.disabledReasonJa)?.scenarioId ?? actions.find((a) => !a.disabledReasonJa)?.scenarioId ?? null;
    setSelectedScenarioId((prev) => {
      if (prev == null) return preferred;
      const current = actions.find((a) => a.scenarioId === prev);
      if (!current || current.disabledReasonJa) return preferred;
      return prev;
    });
  }, [actions]);

  const selectedAction: DgxOperatorConsoleActionApi | undefined =
    selectedScenarioId != null ? actions.find((a) => a.scenarioId === selectedScenarioId) : undefined;

  const openSimpleConfirm = async () => {
    if (!selectedAction) return;
    await confirm({
      title: selectedAction.labelJa,
      description: [selectedAction.subtitleJa, selectedAction.disabledReasonJa ? `\n実行不可: ${selectedAction.disabledReasonJa}` : ''].join('\n'),
      tone: selectedAction.primary ? 'primary' : 'danger',
    });
  };

  const executeSelectedScenario = async () => {
    if (!selectedAction || selectedAction.disabledReasonJa) return;
    setFlowBusy(true);
    setResultNote(null);
    try {
      // 実行指紋が必要なため、内部で preview→execute を連続実行する。
      const previewResult = await postDgxAction({
        type: 'PREVIEW_ORCHESTRATION_SCENARIO',
        scenarioId: selectedAction.scenarioId,
      });
      const preview = previewResult.scenarioPreview;
      if (!preview) {
        throw new Error(previewResult.message || '実行計画の取得に失敗しました');
      }

      const ok = await confirm({
        title: `${selectedAction.labelJa} を実行`,
        description: [
          selectedAction.subtitleJa,
          '',
          ...preview.warnings.slice(0, 2).map((w) => `・${w}`),
        ].join('\n'),
        tone: preview.warnings.length > 0 ? 'danger' : 'primary',
      });
      if (!ok) return;

      const executeResult = await postDgxAction({
        type: 'EXECUTE_ORCHESTRATION_SCENARIO',
        scenarioId: preview.scenarioId,
        planFingerprint: preview.planFingerprint,
        confirmed: true,
      });
      onControlUiError(null);
      setResultNote({
        tone: executeResult.scenarioExecute?.success === false ? 'error' : 'success',
        message:
          executeResult.scenarioExecute?.success === false && executeResult.scenarioExecute.failureMessageJa
            ? `${executeResult.message} — ${executeResult.scenarioExecute.failureMessageJa}`
            : executeResult.message,
      });
      await qc.invalidateQueries({ queryKey: dgxResourceQueryKeys.overview });
    } catch (error) {
      const message = getDgxResourceApiErrorMessage(error);
      onControlUiError(message);
      setResultNote({ tone: 'error', message });
    } finally {
      setFlowBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-lg font-semibold text-white/95">やりたいこと</h3>
        <p className="mt-0.5 text-sm text-white/55">4つの操作だけ使ってください。内部IDや詳細ログは下部の詳細画面へ退避しています。</p>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {actions.map((action) => {
          const selected = selectedScenarioId === action.scenarioId;
          const disabled = Boolean(action.disabledReasonJa) || busy;
          return (
            <button
              key={action.id}
              type="button"
              disabled={disabled}
              onClick={() => {
                setSelectedScenarioId(action.scenarioId);
                setResultNote(null);
              }}
              className={clsx(
                'rounded-xl border px-3 py-3 text-left transition disabled:cursor-not-allowed',
                action.primary ? 'border-cyan-400/40 bg-cyan-950/20' : 'border-white/12 bg-black/30',
                selected && 'ring-2 ring-cyan-400/50',
                disabled && 'opacity-45'
              )}
            >
              <div className="text-xl">{scenarioIcon(action.scenarioId)}</div>
              <div className="mt-1 text-xl font-semibold text-white">{action.labelJa}</div>
              <p className="mt-1 text-sm text-white/65">{action.subtitleJa}</p>
              {action.disabledReasonJa ? <p className="mt-2 text-sm text-amber-200">現在は実行できません: {action.disabledReasonJa}</p> : null}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-black/25 p-3">
        <p className="mr-auto text-sm text-white/70">
          選択中: <span className="font-semibold text-white">{selectedAction?.labelJa ?? 'なし'}</span>
        </p>
        <Button type="button" variant="ghostOnDark" disabled={!selectedAction || busy} onClick={() => void openSimpleConfirm()}>
          内容を確認
        </Button>
        <Button type="button" variant="primary" disabled={!selectedAction || !!selectedAction?.disabledReasonJa || busy} onClick={() => void executeSelectedScenario()}>
          実行する →
        </Button>
      </div>

      {resultNote ? (
        <p
          role="status"
          className={clsx(
            'rounded-lg border px-3 py-2 text-sm',
            resultNote.tone === 'success'
              ? 'border-emerald-500/35 bg-emerald-950/25 text-emerald-100'
              : 'border-red-500/35 bg-red-950/25 text-red-100'
          )}
        >
          {resultNote.message}
        </p>
      ) : null}
    </div>
  );
}
