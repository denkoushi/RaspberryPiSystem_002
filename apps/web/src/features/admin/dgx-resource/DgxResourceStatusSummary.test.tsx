import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DgxResourceStatusSummary } from './DgxResourceStatusSummary';

import type { DgxResourceOverview } from '../../../api/dgx-resource.types';

function makeOverview(partial?: Partial<DgxResourceOverview>): DgxResourceOverview {
  return {
    generatedAt: new Date().toISOString(),
    kpis: {
      gpuUtilPct: 10,
      unifiedMemoryUsedGiB: 40,
      unifiedMemoryTotalGiB: 128,
      freeMemoryGiB: 88,
      policyMode: 'business_first',
      policyLabel: '業務優先',
    },
    policy: {
      mode: 'business_first',
      previousMode: null,
      comfyStartBlockedHint: false,
    },
    runtime: {
      localLlmMode: 'always_on',
      runtimeControlConfigured: true,
      warmWindow: { enabled: false },
    },
    optionalProbes: {
      metricsConfigured: true,
      comfyHealthConfigured: true,
      embeddingHealthConfigured: true,
      sparkHostConfigured: true,
      comfyRuntimeControlConfigured: true,
      experimentLabHealthConfigured: true,
      experimentLabRuntimeControlConfigured: true,
      agentContainerHealthConfigured: false,
      agentContainerRuntimeControlConfigured: false,
    },
    targets: [],
    sparkHost: {
      configured: true,
      probedAt: new Date().toISOString(),
      status: 'running',
    },
    services: [],
    notes: [],
    monitoring: {
      activeInferenceSummary: null,
      sparkSummaryJa: 'ok',
      alerts: [],
      targetHighlights: [],
      lastScenarioFailure: null,
    },
    runtimeSummary: {
      activeProfileId: 'business_qwen36_27b_nvfp4',
      activeProfileDisplayNameJa: 'Qwen3.6 27B NVFP4',
      activeBackend: 'blue',
      businessReady: true,
      businessReadyDetailJa: 'ready',
      policyMode: 'business_first',
      policyLabel: '業務優先',
      runtimeSource: 'model_profile_state',
      inferenceDegraded: false,
      resourceOwner: 'business',
      resourceOwnerLabelJa: '業務',
      resourceStateStatus: 'ready',
      resourceStateDetailJa: 'ready',
      businessRuntimeIntentProfileId: 'business_qwen36_27b_nvfp4',
      businessRuntimeIntentAlignedWithActive: true,
      businessRuntimeIntentSource: 'orchestration',
    },
    modelProfiles: {
      configured: true,
      status: 'ok',
      activeProfileId: 'business_qwen36_27b_nvfp4',
      activeStateBackend: 'blue',
      pendingProfileId: null,
      lastLoadedProfileId: 'business_qwen36_27b_nvfp4',
      available: [
        {
          id: 'business_qwen36_27b_nvfp4',
          displayNameJa: 'Qwen3.6 27B NVFP4',
          backend: 'blue',
          servedAlias: 'system-prod-primary',
          recommended: true,
          enabled: true,
          status: 'available',
          canonicalNames: [],
          legacyNames: [],
        },
        {
          id: 'business_qwen35_35b_gguf',
          displayNameJa: 'Qwen3.5 35B GGUF',
          backend: 'green',
          servedAlias: 'system-prod-primary',
          recommended: false,
          enabled: true,
          status: 'available',
          canonicalNames: [],
          legacyNames: [],
        },
      ],
      businessReturnSelectable: [],
    },
    ...partial,
  };
}

describe('DgxResourceStatusSummary', () => {
  it('shows aligned intent and 問題なし when state is healthy', () => {
    render(<DgxResourceStatusSummary overview={makeOverview()} />);

    expect(screen.getByLabelText('DGX 運用状態サマリー')).toBeInTheDocument();
    expect(screen.getByText('業務優先')).toBeInTheDocument();
    expect(screen.getAllByText('Qwen3.6 27B NVFP4').length).toBeGreaterThan(0);
    expect(screen.getByText('問題なし')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows mismatch warning and business-return hint when intent differs from active profile', () => {
    render(
      <DgxResourceStatusSummary
        overview={makeOverview({
          runtimeSummary: {
            ...makeOverview().runtimeSummary!,
            activeProfileId: 'business_qwen36_27b_nvfp4',
            activeProfileDisplayNameJa: 'Qwen3.6 27B NVFP4',
            businessRuntimeIntentProfileId: 'business_qwen35_35b_gguf',
            businessRuntimeIntentAlignedWithActive: false,
          },
        })}
      />
    );

    expect(screen.getByText('Qwen3.5 35B GGUF')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/Active Model と不一致/);
    expect(screen.getByRole('status')).toHaveTextContent(/私用→業務.*実験→業務/);
  });

  it('prioritizes last scenario failure in next action hint', () => {
    render(
      <DgxResourceStatusSummary
        overview={makeOverview({
          monitoring: {
            ...makeOverview().monitoring,
            lastScenarioFailure: {
              scenarioId: 'business_to_private',
              at: new Date().toISOString(),
              message: 'gateway stop failed',
              completedStepOrders: [1],
            },
          },
          runtimeSummary: {
            ...makeOverview().runtimeSummary!,
            businessRuntimeIntentProfileId: 'business_qwen35_35b_gguf',
            businessRuntimeIntentAlignedWithActive: false,
          },
        })}
      />
    );

    expect(screen.getByRole('status')).toHaveTextContent(/直近のガイド失敗.*gateway stop failed/);
  });
});
