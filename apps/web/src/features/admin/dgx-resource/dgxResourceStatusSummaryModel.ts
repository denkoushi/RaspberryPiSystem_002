import { resolvePolicyProfile } from './dgxResourceUiMetadataResolve';

import type { DgxResourceOverview } from '../../../api/dgx-resource.types';

export type DgxResourceStatusSummaryNextActionTone = 'good' | 'warn' | 'danger' | 'info';

export type DgxResourceStatusSummaryModel = {
  policyModeLabel: string;
  activeModelLabel: string;
  intentProfileId: string | null;
  intentDisplayLabel: string | null;
  intentMismatch: boolean;
  intentMismatchHint: string | null;
  nextActionLabel: string;
  nextActionTone: DgxResourceStatusSummaryNextActionTone;
};

function resolveActiveModelLabel(overview: DgxResourceOverview): string {
  const summary = overview.runtimeSummary;
  if (summary?.activeProfileDisplayNameJa) return summary.activeProfileDisplayNameJa;
  if (summary?.activeProfileId) {
    const fromCatalog = overview.modelProfiles?.available.find((p) => p.id === summary.activeProfileId);
    return fromCatalog?.displayNameJa ?? summary.activeProfileId;
  }
  return '未ロード';
}

function resolveIntentDisplayLabel(overview: DgxResourceOverview): string | null {
  const intentId = overview.runtimeSummary?.businessRuntimeIntentProfileId;
  if (!intentId) return null;
  const fromCatalog = overview.modelProfiles?.available.find((p) => p.id === intentId);
  return fromCatalog?.displayNameJa ?? intentId;
}

function buildNextAction(
  overview: DgxResourceOverview
): Pick<DgxResourceStatusSummaryModel, 'nextActionLabel' | 'nextActionTone'> {
  const failure = overview.monitoring?.lastScenarioFailure;
  if (failure) {
    return {
      nextActionLabel: `直近のガイド失敗 — ${failure.message}（詳細・保守のログで確認）`,
      nextActionTone: 'warn',
    };
  }

  const summary = overview.runtimeSummary;
  if (summary?.businessRuntimeIntentAlignedWithActive === false) {
    return {
      nextActionLabel: 'Pi5 業務意図と Active Model が不一致 — 「私用→業務」または「実験→業務」を再実行してください',
      nextActionTone: 'warn',
    };
  }

  return {
    nextActionLabel: '問題なし',
    nextActionTone: 'good',
  };
}

/** overview からコンパクト状態サマリー行の表示モデルを構築（React 非依存）。 */
export function buildDgxResourceStatusSummaryModel(overview: DgxResourceOverview): DgxResourceStatusSummaryModel {
  const policyMode = overview.policy.mode;
  const policyModeLabel = resolvePolicyProfile(policyMode, overview).titleShort;
  const intentProfileId = overview.runtimeSummary?.businessRuntimeIntentProfileId ?? null;
  const intentMismatch = overview.runtimeSummary?.businessRuntimeIntentAlignedWithActive === false;
  const nextAction = buildNextAction(overview);

  return {
    policyModeLabel,
    activeModelLabel: resolveActiveModelLabel(overview),
    intentProfileId,
    intentDisplayLabel: resolveIntentDisplayLabel(overview),
    intentMismatch,
    intentMismatchHint: intentMismatch
      ? 'Active Model と不一致（次の on-demand /start で揃えるか業務復帰を再実行）'
      : null,
    ...nextAction,
  };
}
