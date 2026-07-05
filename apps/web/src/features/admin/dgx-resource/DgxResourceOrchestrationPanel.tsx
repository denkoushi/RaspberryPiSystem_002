import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import {
  dgxResourceQueryKeys,
  getDgxResourceApiErrorMessage,
  postDgxResourceAction,
} from '../../../api/dgx-resource';
import { Button } from '../../../components/ui/Button';
import { useConfirm } from '../../../contexts/ConfirmContext';

import { resolveScenarioMeta, resolveScenarioOrder } from './dgxResourceUiMetadataResolve';

import type {
  DgxOrchestrationScenarioIdApi,
  DgxResourceActionResult,
  DgxResourceOverview,
  DgxResourceScenarioExecuteResultApi,
  ScenarioPlanPreviewApi,
} from '../../../api/dgx-resource.types';

type Props = {
  onControlUiError: (message: string | null) => void;
  /** 提供時は uiMetadata を優先（未提供時はローカル fallback） */
  overview?: Pick<DgxResourceOverview, 'uiMetadata'>;
};

function formatStepsForConfirm(preview: ScenarioPlanPreviewApi): string {
  return preview.steps.map((s) => `${s.order}. ${s.summaryJa}`).join('\n');
}

export function DgxResourceOrchestrationPanel({ onControlUiError, overview }: Props) {
  const qc = useQueryClient();
  const confirm = useConfirm();

  const [scenarioId, setScenarioId] = useState<DgxOrchestrationScenarioIdApi>('business_to_private');
  const [lastPreview, setLastPreview] = useState<ScenarioPlanPreviewApi | null>(null);
  const [resultNote, setResultNote] = useState<string | null>(null);
  const [lastExecute, setLastExecute] = useState<{
    message: string;
    detail: DgxResourceScenarioExecuteResultApi;
  } | null>(null);

  const scenarioOrder = resolveScenarioOrder(overview);
  const meta = resolveScenarioMeta(scenarioId, overview);

  useEffect(() => {
    setLastPreview(null);
    setResultNote(null);
    setLastExecute(null);
  }, [scenarioId]);

  const previewMutation = useMutation({
    mutationFn: () =>
      postDgxResourceAction({
        type: 'PREVIEW_ORCHESTRATION_SCENARIO',
        scenarioId,
      }),
    onMutate: () => {
      setResultNote(null);
      setLastExecute(null);
    },
    onSuccess: (data: DgxResourceActionResult) => {
      onControlUiError(null);
      if (data.scenarioPreview != null && data.scenarioPreview.scenarioId === scenarioId) {
        setLastPreview(data.scenarioPreview);
      } else if (data.scenarioPreview != null) {
        setLastPreview(null);
      }
      setResultNote(`プレビュー: ${data.message}`);
    },
    onError: (e) => {
      setLastPreview(null);
      onControlUiError(getDgxResourceApiErrorMessage(e));
    },
  });

  const execMutation = useMutation({
    mutationFn: ({ fp, scenario }: { fp: string; scenario: DgxOrchestrationScenarioIdApi }) =>
      postDgxResourceAction({
        type: 'EXECUTE_ORCHESTRATION_SCENARIO',
        scenarioId: scenario,
        planFingerprint: fp,
        confirmed: true,
      }),
    onSuccess: async (data: DgxResourceActionResult) => {
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
      await Promise.all([
        qc.invalidateQueries({ queryKey: dgxResourceQueryKeys.overview }),
        qc.invalidateQueries({ queryKey: ['dgx-resource', 'events'] }),
      ]);
    },
    onError: (e) => {
      onControlUiError(getDgxResourceApiErrorMessage(e));
    },
  });

  const previewBusy = previewMutation.isPending;
  const execBusy = execMutation.isPending;
  const busy = previewBusy || execBusy;

  const canExecute = Boolean(lastPreview) && lastPreview?.scenarioId === scenarioId && !busy;

  return (
    <div className="flex shrink-0 flex-col gap-2.5 rounded-lg border border-teal-400/25 bg-teal-950/35 p-3">
      <h2 className="text-lg font-semibold text-teal-50/95">複合運用ガイド（確認付き）</h2>
      <p className="text-sm leading-snug text-white/70">
        まず「プレビュー」で手順・指紋を取得します。実行はプレビューと同じ環境設定を前提として指紋照合されます（Stale 時は409）。
      </p>

      <div className="flex flex-wrap gap-1">
        {scenarioOrder.map((sid) => {
          const m = resolveScenarioMeta(sid, overview);
          return (
            <Button
              key={sid}
              type="button"
              variant={sid === scenarioId ? 'primary' : 'ghost'}
              className={`px-3 py-1.5 text-xs ${sid === scenarioId ? '' : 'border border-white/12'}`}
              disabled={busy}
              onClick={() => setScenarioId(sid)}
            >
              {m.titleJa}
            </Button>
          );
        })}
      </div>

      <p className="text-sm text-white/60">
        <span className="font-medium text-teal-100/90">{meta.titleJa}</span> — {meta.descriptionJa}
      </p>

      {meta.cautionsJa.length > 0 ? (
        <ul className="list-none space-y-1 rounded border border-amber-400/25 bg-amber-500/10 px-2.5 py-2 text-sm leading-snug text-amber-100/95">
          {meta.cautionsJa.map((caution) => (
            <li key={caution}>⚠ {caution}</li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          className="px-3 py-2 text-sm"
          disabled={busy}
          onClick={() => previewMutation.mutate()}
        >
          プレビュー取得
        </Button>

        <Button
          type="button"
          variant="primary"
          className="px-3 py-2 text-sm"
          disabled={!canExecute}
          onClick={async () => {
            if (!lastPreview) return;
            const preview = lastPreview;
            const ok = await confirm({
              title: '運用ガイドの実行',
              description: [
                `種別（内部キー）: ${preview.scenarioId}`,
                `実行計画 ID（先頭16文字）: ${preview.planFingerprint.slice(0, 16)}…`,
                '',
                '進むステップ:',
                formatStepsForConfirm(preview),
                '',
                preview.warnings.length > 0
                  ? ['確認事項:', ...preview.warnings.map((w) => `・${w}`), ''].join('\n')
                  : '',
              ].join('\n'),
              tone: preview.warnings.length > 2 ? 'danger' : 'primary',
            });
            if (!ok) return;
            execMutation.mutate({
              fp: preview.planFingerprint,
              scenario: preview.scenarioId,
            });
          }}
        >
          この内容で実行する
        </Button>
      </div>

      {lastPreview && lastPreview.scenarioId === scenarioId ? (
        <div className="rounded border border-white/10 bg-black/30 p-2.5 text-sm text-white/75">
          <div className="font-mono text-xs text-teal-200/95">
            実行計画 ID（指紋）:{' '}
            <span className="break-all">{lastPreview.planFingerprint.slice(0, 24)}…</span>
          </div>
          <ol className="mt-2 list-decimal space-y-1 pl-5 leading-snug">
            {lastPreview.steps.map((s) => (
              <li key={s.order}>{s.summaryJa}</li>
            ))}
          </ol>
          {lastPreview.warnings.length > 0 ? (
            <ul className="mt-2 list-none space-y-1 border-t border-white/10 pt-2 text-amber-100/92">
              {lastPreview.warnings.map((w) => (
                <li key={w}>⚠ {w}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {resultNote ? (
        <p className="text-sm text-teal-100/90" role="status">
          {resultNote}
        </p>
      ) : null}

      {lastExecute ? (
        <div className="rounded border border-white/10 bg-black/25 p-2.5 text-sm text-white/75">
          <div className="font-medium text-teal-100/90">
            {lastExecute.detail.success ? '実行結果: 成功' : '実行結果: 部分成功または失敗'}
          </div>
          <div className="mt-1 leading-snug">{lastExecute.message}</div>
          <div className="mt-1 text-xs text-white/60">
            完了 step order: {lastExecute.detail.completedStepOrders.join(', ') || 'none'}
          </div>
          {lastExecute.detail.recommendedNextJa ? (
            <div className="mt-1 text-xs leading-snug text-white/65">
              次の確認: {lastExecute.detail.recommendedNextJa}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
