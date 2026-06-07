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
  DgxModelProfilesOverviewApi,
  DgxResourceActionBody,
  DgxResourceActionResult,
  DgxResourceOperatorConsoleApi,
  DgxResourceRuntimeSummaryApi,
} from '../../../api/dgx-resource.types';

const DGX_SCENARIO_PENDING_EVENT = 'dgx-resource:primary-scenario-pending-changed';
const DGX_SCENARIO_PENDING_STORAGE_KEY = 'dgx-resource:primary-scenario-pending';
const DGX_SCENARIO_PENDING_TTL_MS = 20 * 60 * 1000;
const BUSINESS_RETURN_PENDING_MESSAGE =
  '復帰処理を開始しました。DGX 側でモデルをロード中です。\nReady まで数分かかることがあります。画面を閉じても処理は継続します。';
let dgxPrimaryScenarioPendingCount = 0;

type DgxPersistedScenarioPendingState = {
  pending: true;
  startedAt: number;
  scenarioId: DgxOrchestrationScenarioIdApi | null;
};

function emitDgxScenarioPendingChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(DGX_SCENARIO_PENDING_EVENT, {
      detail: { pending: dgxPrimaryScenarioPendingCount > 0, count: dgxPrimaryScenarioPendingCount },
    })
  );
}

function isBusinessReturnScenario(scenarioId: DgxOrchestrationScenarioIdApi | null | undefined): boolean {
  return scenarioId === 'private_to_business' || scenarioId === 'experiment_to_business';
}

function businessReturnReady(runtimeSummary?: DgxResourceRuntimeSummaryApi): boolean {
  return runtimeSummary?.businessReady === true && runtimeSummary.resourceOwner === 'business';
}

function readPersistedPendingState(): DgxPersistedScenarioPendingState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(DGX_SCENARIO_PENDING_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { pending?: boolean; startedAt?: number } | null;
    if (!parsed?.pending) return null;
    if (typeof parsed.startedAt !== 'number') return null;
    if (Date.now() - parsed.startedAt > DGX_SCENARIO_PENDING_TTL_MS) {
      window.sessionStorage.removeItem(DGX_SCENARIO_PENDING_STORAGE_KEY);
      return null;
    }
    return {
      pending: true,
      startedAt: parsed.startedAt,
      scenarioId: isBusinessReturnScenario((parsed as { scenarioId?: unknown }).scenarioId as DgxOrchestrationScenarioIdApi)
        ? ((parsed as { scenarioId: DgxOrchestrationScenarioIdApi }).scenarioId)
        : null,
    };
  } catch {
    return null;
  }
}

function persistPendingState(pending: boolean, scenarioId: DgxOrchestrationScenarioIdApi | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (!pending) {
      window.sessionStorage.removeItem(DGX_SCENARIO_PENDING_STORAGE_KEY);
      return;
    }
    window.sessionStorage.setItem(
      DGX_SCENARIO_PENDING_STORAGE_KEY,
      JSON.stringify({
        pending: true,
        startedAt: Date.now(),
        scenarioId,
      })
    );
  } catch {
    // best effort
  }
}

type Props = {
  operator: DgxResourceOperatorConsoleApi;
  modelProfiles?: DgxModelProfilesOverviewApi;
  runtimeSummary?: DgxResourceRuntimeSummaryApi;
  postDgxAction: (body: DgxResourceActionBody) => Promise<DgxResourceActionResult>;
  actionBusy: boolean;
  externalBusy?: boolean;
  onControlUiError: (message: string | null) => void;
};

/** 日常運用向け UI: 4操作を選んで、そのまま確認→実行。 */
export function DgxResourcePrimaryScenarioFlow({
  operator,
  modelProfiles,
  runtimeSummary,
  postDgxAction,
  actionBusy,
  externalBusy = false,
  onControlUiError,
}: Props) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const actions = useMemo(() => orderPrimaryScenarioActions(operator.operatorActions), [operator.operatorActions]);
  const [selectedScenarioId, setSelectedScenarioId] = useState<DgxOrchestrationScenarioIdApi | null>(null);
  const [selectedModelProfileId, setSelectedModelProfileId] = useState<string | null>(null);
  const [flowBusy, setFlowBusy] = useState(false);
  const [globalPending, setGlobalPending] = useState(() => dgxPrimaryScenarioPendingCount > 0 || readPersistedPendingState() != null);
  const [resultNote, setResultNote] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const busy = actionBusy || flowBusy || globalPending || externalBusy;
  const persistedPending = readPersistedPendingState();
  const businessReturnPending =
    isBusinessReturnScenario(persistedPending?.scenarioId) ||
    (globalPending && isBusinessReturnScenario(selectedScenarioId));

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
  const needsModelProfile =
    selectedAction?.scenarioId === 'private_to_business' || selectedAction?.scenarioId === 'experiment_to_business';
  const selectableProfiles = useMemo(() => {
    if (modelProfiles?.businessReturnSelectable) {
      return modelProfiles.businessReturnSelectable;
    }
    return (
      modelProfiles?.available.filter(
        (profile) =>
          profile.enabled &&
          profile.status === 'available' &&
          profile.businessOrchestrationEligible !== false
      ) ?? []
    );
  }, [modelProfiles?.businessReturnSelectable, modelProfiles?.available]);
  const selectedModelProfile = selectableProfiles.find((profile) => profile.id === selectedModelProfileId);
  const selectedRuntime = selectedModelProfile?.runtimeProfile;
  const selectedRuntimeBudget =
    selectedRuntime?.vllm?.gpuMemoryUtilization != null
      ? `vLLM memory budget ${Math.round(selectedRuntime.vllm.gpuMemoryUtilization * 100)}%`
      : selectedRuntime?.llamaCpp?.ctxSize != null
        ? `llama.cpp ctx ${selectedRuntime.llamaCpp.ctxSize}`
        : null;

  useEffect(() => {
    const sync = () => setGlobalPending(dgxPrimaryScenarioPendingCount > 0 || readPersistedPendingState() != null);
    sync();
    if (readPersistedPendingState() != null) {
      setGlobalPending(true);
    }
    if (typeof window === 'undefined') return;
    window.addEventListener(DGX_SCENARIO_PENDING_EVENT, sync as EventListener);
    return () => {
      window.removeEventListener(DGX_SCENARIO_PENDING_EVENT, sync as EventListener);
    };
  }, []);

  const businessReady = runtimeSummary?.businessReady;
  const resourceOwner = runtimeSummary?.resourceOwner;

  useEffect(() => {
    const pending = readPersistedPendingState();
    if (!isBusinessReturnScenario(pending?.scenarioId) || !businessReturnReady({ businessReady, resourceOwner })) return;
    persistPendingState(false, null);
    setGlobalPending(dgxPrimaryScenarioPendingCount > 0);
    setResultNote((prev) => prev ?? { tone: 'success', message: '業務推論が Ready になりました。' });
    emitDgxScenarioPendingChanged();
  }, [businessReady, resourceOwner]);

  useEffect(() => {
    if (!needsModelProfile) return;
    setSelectedModelProfileId((prev) => {
      if (prev && selectableProfiles.some((profile) => profile.id === prev)) return prev;
      const activeSelectable = selectableProfiles.find((profile) => profile.id === modelProfiles?.activeProfileId);
      return (
        selectableProfiles.find((profile) => profile.recommended)?.id ??
        activeSelectable?.id ??
        selectableProfiles[0]?.id ??
        null
      );
    });
  }, [modelProfiles?.activeProfileId, needsModelProfile, selectableProfiles]);

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
    if (needsModelProfile && !selectedModelProfileId) {
      onControlUiError('業務復帰に使うモデルプロファイルを選択してください');
      return;
    }
    setFlowBusy(true);
    dgxPrimaryScenarioPendingCount += 1;
    persistPendingState(true, selectedAction.scenarioId);
    emitDgxScenarioPendingChanged();
    setResultNote(null);
    let keepLogicalPending = false;
    let executeDispatched = false;
    try {
      // 実行指紋が必要なため、内部で preview→execute を連続実行する。
      const previewResult = await postDgxAction({
        type: 'PREVIEW_ORCHESTRATION_SCENARIO',
        scenarioId: selectedAction.scenarioId,
        ...(needsModelProfile && selectedModelProfileId ? { modelProfileId: selectedModelProfileId } : {}),
      });
      const preview = previewResult.scenarioPreview;
      if (!preview) {
        throw new Error(previewResult.message || '実行計画の取得に失敗しました');
      }

      const ok = await confirm({
        title: `${selectedAction.labelJa} を実行`,
        description: [
          selectedAction.subtitleJa,
          needsModelProfile && selectedModelProfile
            ? `業務モデル: ${selectedModelProfile.displayNameJa} [${selectedModelProfile.id}]`
            : '',
          '',
          ...preview.warnings.slice(0, 2).map((w) => `・${w}`),
        ].filter(Boolean).join('\n'),
        tone: preview.warnings.length > 0 ? 'danger' : 'primary',
      });
      if (!ok) return;

      executeDispatched = true;
      const executeResult = await postDgxAction({
        type: 'EXECUTE_ORCHESTRATION_SCENARIO',
        scenarioId: preview.scenarioId,
        planFingerprint: preview.planFingerprint,
        confirmed: true,
        ...(needsModelProfile && selectedModelProfileId ? { modelProfileId: selectedModelProfileId } : {}),
      });
      onControlUiError(null);
      const se = executeResult.scenarioExecute;
      keepLogicalPending = se?.outcomeKind === 'in_progress';
      const readinessLines =
        se?.readinessChecksJa && se.readinessChecksJa.length > 0
          ? [
              '',
              'Ready 確認:',
              ...se.readinessChecksJa.map((c) => `・${c.code}: ${c.satisfied ? 'OK' : '未達'} — ${c.detailJa}`),
            ]
          : [];
      const rollbackLines =
        se?.rollback?.attempted && (se.rollback.policyRestoredJa || (se.rollback.workloadStepsJa?.length ?? 0) > 0)
          ? [
              '',
              '自動復帰:',
              ...(se.rollback.policyRestoredJa ? [`・${se.rollback.policyRestoredJa}`] : []),
              ...((se.rollback.workloadStepsJa ?? []).map((s) => `・${s}`) as string[]),
            ]
          : [];

      setResultNote({
        tone: executeResult.scenarioExecute?.success === false ? 'error' : 'success',
        message:
          executeResult.scenarioExecute?.success === false && executeResult.scenarioExecute.failureMessageJa
            ? `${executeResult.message} — ${executeResult.scenarioExecute.failureMessageJa}${readinessLines.join('\n')}${rollbackLines.join('\n')}${se?.recommendedNextJa ? `\n\n次の手順: ${se.recommendedNextJa}` : ''}`
            : `${executeResult.message}${readinessLines.join('\n')}${rollbackLines.join('\n')}`,
      });
      await qc.invalidateQueries({ queryKey: dgxResourceQueryKeys.overview });
    } catch (error) {
      const message = getDgxResourceApiErrorMessage(error);
      if (executeDispatched && needsModelProfile && /timeout|タイムアウト|ECONNABORTED/i.test(message)) {
        keepLogicalPending = true;
        onControlUiError(null);
        setResultNote({ tone: 'success', message: BUSINESS_RETURN_PENDING_MESSAGE });
        await qc.invalidateQueries({ queryKey: dgxResourceQueryKeys.overview });
        return;
      }
      onControlUiError(message);
      setResultNote({ tone: 'error', message });
    } finally {
      setFlowBusy(false);
      dgxPrimaryScenarioPendingCount = Math.max(0, dgxPrimaryScenarioPendingCount - 1);
      if (!keepLogicalPending && dgxPrimaryScenarioPendingCount === 0) {
        persistPendingState(false, null);
      }
      emitDgxScenarioPendingChanged();
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-lg font-semibold text-white/95">やりたいこと</h3>
        <span className="rounded-full border border-emerald-400/25 bg-emerald-950/25 px-2 py-0.5 text-xs font-semibold text-emerald-100">
          保証: Strict Ready
        </span>
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
              <div className="break-words text-xl font-semibold leading-snug text-white">{action.labelJa}</div>
              <p className="mt-1 break-words text-sm leading-snug text-white/65">{action.subtitleJa}</p>
              {action.disabledReasonJa ? (
                <p className="mt-2 break-words text-sm leading-snug text-amber-200">現在は実行できません: {action.disabledReasonJa}</p>
              ) : null}
            </button>
          );
        })}
      </div>

      {needsModelProfile ? (
        <div className="rounded-xl border border-cyan-400/25 bg-black/25 p-3">
          <label className="block text-sm font-semibold text-cyan-100" htmlFor="dgx-business-model-profile">
            業務復帰でロードする LocalLLM モデル
          </label>
          <select
            id="dgx-business-model-profile"
            value={selectedModelProfileId ?? ''}
            disabled={busy || selectableProfiles.length === 0}
            onChange={(event) => setSelectedModelProfileId(event.target.value || null)}
            className="mt-2 w-full rounded-lg border border-white/15 bg-slate-950 px-3 py-2 text-sm text-white disabled:opacity-50"
          >
            {selectableProfiles.length === 0 ? <option value="">選択できるモデルがありません</option> : null}
            {selectableProfiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.displayNameJa} [{profile.id}]
              </option>
            ))}
          </select>
          {selectedModelProfile ? (
            <div className="mt-2 space-y-1 text-xs leading-snug text-white/60">
              <p>
                backend: {selectedModelProfile.backend} / alias: {selectedModelProfile.servedAlias}
                {selectedModelProfile.recommended ? ' / 推奨' : ''}
              </p>
              <p>
                実体: {selectedModelProfile.sourceModelRef ?? selectedModelProfile.storageLocation ?? '未取得'} / 系統:{' '}
                {selectedModelProfile.modelFamily ?? '不明'} / 形式: {selectedModelProfile.format ?? '不明'} / 量子化:{' '}
                {selectedModelProfile.quantization ?? '不明'}
              </p>
              {selectedRuntimeBudget ? (
                <p>
                  運用予算: {selectedRuntimeBudget}
                  {selectedRuntime?.memoryPolicy ? ` / ${selectedRuntime.memoryPolicy}` : ''}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="mt-2 text-xs text-amber-200">
              {modelProfiles?.errorMessageJa ?? 'DGX からモデルプロファイルを取得できませんでした'}
            </p>
          )}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-black/25 p-3">
        <p className="min-w-[12rem] flex-1 break-words text-sm leading-snug text-white/70">
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
            'whitespace-pre-line break-words rounded-lg border px-3 py-2 text-sm leading-snug',
            resultNote.tone === 'success'
              ? 'border-emerald-500/35 bg-emerald-950/25 text-emerald-100'
              : 'border-red-500/35 bg-red-950/25 text-red-100'
          )}
        >
          {resultNote.message}
        </p>
      ) : null}
      {busy ? (
        <div role="status" className="break-words rounded-lg border border-cyan-400/35 bg-cyan-950/25 px-3 py-2 text-sm leading-snug text-cyan-100">
          {businessReturnPending ? (
            <>
              <p>復帰処理を開始しました。DGX 側でモデルをロード中です。</p>
              <p>Ready まで数分かかることがあります。画面を閉じても処理は継続します。</p>
            </>
          ) : (
            <p>進行中: 切替処理を実行中です。別タブへ移動しても処理は継続します。</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
