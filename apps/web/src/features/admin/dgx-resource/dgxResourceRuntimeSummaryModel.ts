import { policyModeBadgeTokens } from './dgxResourceUi';

import type { DgxResourceRuntimeSummaryApi } from '../../../api/dgx-resource.types';

export type DgxResourceRuntimeSummaryItemModel = {
  key: string;
  label: string;
  value: string;
  hint?: string;
  toneClass: string;
};

function backendLabel(backend: 'green' | 'blue' | null): string {
  if (backend === 'green') return 'green (llama.cpp)';
  if (backend === 'blue') return 'blue (vLLM)';
  return '—';
}

function readyTone(ready: boolean, degraded: boolean): string {
  if (ready) return 'text-emerald-200';
  if (degraded) return 'text-amber-200';
  return 'text-white/55';
}

/**
 * overview.runtimeSummary から運用状態ストリップ用モデルを構築（React 非依存）。
 */
export function buildDgxResourceRuntimeSummaryItems(
  summary: DgxResourceRuntimeSummaryApi
): readonly DgxResourceRuntimeSummaryItemModel[] {
  const activeModel =
    summary.activeProfileDisplayNameJa ??
    (summary.activeProfileId ? summary.activeProfileId : '未ロード');

  return [
    {
      key: 'model',
      label: 'Active Model',
      value: activeModel,
      hint:
        summary.runtimeSource === 'model_profile_state'
          ? 'DGX active profile'
          : summary.runtimeSource === 'env_fallback'
            ? 'env フォールバック'
            : undefined,
      toneClass: summary.activeProfileId ? 'text-cyan-100' : 'text-white/55',
    },
    {
      key: 'backend',
      label: 'Backend',
      value: backendLabel(summary.activeBackend),
      toneClass: summary.activeBackend ? 'text-violet-100' : 'text-white/55',
    },
    {
      key: 'ready',
      label: 'Business Ready',
      value: summary.businessReady ? 'Ready' : 'Not Ready',
      hint: summary.businessReadyDetailJa,
      toneClass: readyTone(summary.businessReady, summary.inferenceDegraded),
    },
    {
      key: 'policy',
      label: 'Policy',
      value: summary.policyLabel,
      toneClass: policyModeBadgeTokens(summary.policyMode).split(' ').find((c) => c.startsWith('text-')) ?? 'text-cyan-100',
    },
  ];
}
