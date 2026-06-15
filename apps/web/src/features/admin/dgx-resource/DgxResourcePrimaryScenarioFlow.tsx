import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { useEffect, useMemo, useState } from 'react';

import { dgxResourceQueryKeys, getDgxResourceApiErrorMessage } from '../../../api/dgx-resource';
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

function businessReturnReady(runtimeSummary?: {
  businessReady?: boolean;
  resourceOwner?: DgxResourceRuntimeSummaryApi['resourceOwner'];
}): boolean {
  return runtimeSummary?.businessReady === true && runtimeSummary.resourceOwner === 'business';
}

function compactScenarioLabel(scenarioId: DgxOrchestrationScenarioIdApi): string {
  switch (scenarioId) {
    case 'business_to_private':
      return '業務→私用';
    case 'private_to_business':
      return '私用→業務';
    case 'business_to_experiment':
      return '業務→実験';
    case 'experiment_to_business':
      return '実験→業務';
    default: {
      const _x: never = scenarioId;
      return _x;
    }
  }
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
  const needsModelProfile = isBusinessReturnScenario(selectedAction?.scenarioId);
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

  const resolveBusinessReturnProfileId = (): string | null =>
    selectedModelProfileId ??
    selectableProfiles.find((profile) => profile.recommended)?.id ??
    selectableProfiles.find((profile) => profile.id === modelProfiles?.activeProfileId)?.id ??
    selectableProfiles[0]?.id ??
    null;

  const executeScenario = async (action: DgxOperatorConsoleActionApi) => {
    if (action.disabledReasonJa) return;
    const actionNeedsModelProfile = isBusinessReturnScenario(action.scenarioId);
    const modelProfileIdToUse = actionNeedsModelProfile ? resolveBusinessReturnProfileId() : null;
    const modelProfileForConfirm = selectableProfiles.find((profile) => profile.id === modelProfileIdToUse);
    setSelectedScenarioId(action.scenarioId);
    if (actionNeedsModelProfile && !modelProfileIdToUse) {
      onControlUiError('業務復帰に使うモデルプロファイルを選択してください');
      return;
    }
    setFlowBusy(true);
    dgxPrimaryScenarioPendingCount += 1;
    persistPendingState(true, action.scenarioId);
    emitDgxScenarioPendingChanged();
    setResultNote(null);
    let keepLogicalPending = false;
    let executeDispatched = false;
    try {
      // 実行指紋が必要なため、内部で preview→execute を連続実行する。
      const previewResult = await postDgxAction({
        type: 'PREVIEW_ORCHESTRATION_SCENARIO',
        scenarioId: action.scenarioId,
        ...(actionNeedsModelProfile && modelProfileIdToUse ? { modelProfileId: modelProfileIdToUse } : {}),
      });
      const preview = previewResult.scenarioPreview;
      if (!preview) {
        throw new Error(previewResult.message || '実行計画の取得に失敗しました');
      }

      const ok = await confirm({
        title: `${action.labelJa} を実行`,
        description: [
          action.subtitleJa,
          actionNeedsModelProfile && modelProfileForConfirm
            ? `業務モデル: ${modelProfileForConfirm.displayNameJa} [${modelProfileForConfirm.id}]`
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
        ...(actionNeedsModelProfile && modelProfileIdToUse ? { modelProfileId: modelProfileIdToUse } : {}),
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
      if (executeDispatched && actionNeedsModelProfile && /timeout|タイムアウト|ECONNABORTED/i.test(message)) {
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
    <section className="space-y-3" aria-label="DGX 操作">
      <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
        {actions.map((action) => {
          const selected = selectedScenarioId === action.scenarioId;
          const disabled = Boolean(action.disabledReasonJa) || busy;
          return (
            <button
              key={action.id}
              type="button"
              aria-label={action.labelJa}
              disabled={disabled}
              onClick={() => {
                setSelectedScenarioId(action.scenarioId);
                setResultNote(null);
                void executeScenario(action);
              }}
              className={clsx(
                'grid min-h-[4.25rem] content-center gap-1 rounded-lg border px-3 text-left transition disabled:cursor-not-allowed',
                selected
                  ? 'border-slate-900 bg-slate-950 text-white'
                  : action.primary
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-900 hover:bg-emerald-100'
                    : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50',
                disabled && 'opacity-45'
              )}
              title={action.disabledReasonJa}
            >
              <strong className="text-sm font-bold leading-tight sm:text-[15px]">{compactScenarioLabel(action.scenarioId)}</strong>
              <span className={clsx('line-clamp-2 text-xs font-semibold leading-snug', selected ? 'text-white/65' : 'text-slate-500')}>
                {action.subtitleJa}
              </span>
            </button>
          );
        })}
      </div>

      {needsModelProfile ? (
        <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center">
          <label className="shrink-0 text-sm font-bold text-slate-600" htmlFor="dgx-business-model-profile">
            ロードモデル
          </label>
          <select
            id="dgx-business-model-profile"
            value={selectedModelProfileId ?? ''}
            disabled={busy || selectableProfiles.length === 0}
            onChange={(event) => setSelectedModelProfileId(event.target.value || null)}
            className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900 disabled:opacity-50"
          >
            {selectableProfiles.length === 0 ? <option value="">選択できるモデルがありません</option> : null}
            {selectableProfiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.displayNameJa} [{profile.id}]
              </option>
            ))}
          </select>
          {!selectedModelProfile ? (
            <p className="text-xs font-semibold text-amber-700">
              {modelProfiles?.errorMessageJa ?? 'DGX からモデルプロファイルを取得できませんでした'}
            </p>
          ) : null}
        </div>
      ) : null}

      {resultNote ? (
        <p
          role="status"
          className={clsx(
            'whitespace-pre-line break-words rounded-lg border px-3 py-2 text-sm font-semibold leading-snug',
            resultNote.tone === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-red-200 bg-red-50 text-red-800'
          )}
        >
          {resultNote.message}
        </p>
      ) : null}
      {busy ? (
        <div role="status" className="break-words rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-semibold leading-snug text-sky-800">
          {businessReturnPending ? (
            <>
              <p>業務復帰中</p>
              <p>DGX 側でモデルをロードしています。</p>
            </>
          ) : (
            <p>進行中: 切替処理を実行中です。別タブへ移動しても処理は継続します。</p>
          )}
        </div>
      ) : null}
    </section>
  );
}
