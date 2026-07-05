import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { DgxResourceDashboard } from './DgxResourceDashboard';

import type { DgxResourceOverview } from '../../../api/dgx-resource.types';
import type { ReactElement } from 'react';

const { fetchDgxResourceOverview, fetchDgxResourceEvents, useConfirmMock } = vi.hoisted(() => ({
  fetchDgxResourceOverview: vi.fn(),
  fetchDgxResourceEvents: vi.fn(),
  useConfirmMock: vi.fn(async () => true),
}));

vi.mock('../../../api/dgx-resource', () => ({
  dgxResourceQueryKeys: {
    overview: ['dgx-resource', 'overview'],
    events: (limit: number) => ['dgx-resource', 'events', limit],
  },
  fetchDgxResourceOverview,
  fetchDgxResourceEvents,
  getDgxResourceApiErrorMessage: (error: unknown) => (error instanceof Error ? error.message : 'error'),
  postDgxResourceAction: vi.fn(),
}));

vi.mock('../../../contexts/ConfirmContext', () => ({
  useConfirm: () => useConfirmMock,
}));

vi.mock('./DgxResourcePrimaryScenarioFlow', () => ({
  DgxResourcePrimaryScenarioFlow: () => <div>primary-scenario-flow</div>,
}));

vi.mock('./DgxResourcePolicyPanel', () => ({
  DgxResourcePolicyPanel: () => <div>policy-panel</div>,
}));

vi.mock('./DgxResourceSparkStatusPanel', () => ({
  DgxResourceSparkStatusPanel: () => <div>spark-panel</div>,
}));

vi.mock('./DgxResourceTargetGrid', () => ({
  DgxResourceTargetGrid: () => <div>target-grid</div>,
}));

vi.mock('./DgxResourceOrchestrationPanel', () => ({
  DgxResourceOrchestrationPanel: () => <div>orchestration-panel</div>,
}));

vi.mock('./DgxResourceWarmRuntimeNotice', () => ({
  DgxResourceWarmRuntimeNotice: () => <div>warm-runtime-notice</div>,
}));

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function makeOverview(): DgxResourceOverview {
  return {
    generatedAt: new Date().toISOString(),
    kpis: {
      gpuUtilPct: 44,
      gpuTemperatureC: 46,
      gpuPowerDrawW: 11,
      gpuPowerLimitW: 120,
      gpuClockSmMhz: 1280,
      gpuClockGraphicsMhz: 1280,
      gpuPstate: 'P2',
      gpuName: 'NVIDIA GB10',
      driverVersion: '580.159.03',
      unifiedMemoryUsedGiB: 96,
      unifiedMemoryTotalGiB: 128,
      freeMemoryGiB: 32,
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
    targets: [
      {
        id: 'system-prod-inference',
        kind: 'http_probe',
        displayName: 'system-prod-inference',
        capabilities: ['readStatus'],
        status: 'running',
        badges: [],
        metaLines: [],
      },
      {
        id: 'private-comfyui',
        kind: 'http_probe',
        displayName: 'private-comfyui',
        capabilities: ['readStatus'],
        status: 'stopped',
        badges: [],
        metaLines: [],
      },
      {
        id: 'experiment-lab',
        kind: 'http_probe',
        displayName: 'experiment-lab',
        capabilities: ['readStatus'],
        status: 'unknown',
        badges: [],
        metaLines: [],
      },
    ],
    sparkHost: {
      configured: true,
      probedAt: new Date().toISOString(),
      status: 'running',
    },
    services: [],
    notes: ['note'],
    monitoring: {
      activeInferenceSummary: null,
      sparkSummaryJa: 'spark ok',
      alerts: [],
      targetHighlights: [],
      lastScenarioFailure: null,
    },
    operator: {
      workloads: [],
      operatorSummary: {
        headlineJa: 'summary',
        policyMode: 'business_first',
        policyLabelJa: '業務優先',
        previousMode: null,
        previousPolicyLabelJa: null,
        comfyStartBlockedHint: false,
        inferenceSparkLineJa: null,
        alertPreviewJa: [],
      },
      operatorActions: [],
    },
    runtimeSummary: {
      activeProfileId: 'business_qwen36_27b_nvfp4',
      activeProfileDisplayNameJa: '27B',
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
        {
          id: 'business_ornith_35b_nvfp4',
          displayNameJa: 'Ornith 1.0 35B NVFP4',
          backend: 'blue',
          servedAlias: 'system-prod-primary',
          recommended: false,
          businessOrchestrationEligible: true,
          enabled: true,
          status: 'available',
          canonicalNames: [],
          legacyNames: [],
          declaredCapabilities: ['text', 'vision'],
        },
      ],
      businessReturnSelectable: [],
    },
  };
}

describe('DgxResourceDashboard', () => {
  beforeEach(() => {
    fetchDgxResourceOverview.mockReset();
    fetchDgxResourceEvents.mockReset();
    useConfirmMock.mockClear();
    window.sessionStorage.clear();
  });

  it('renders compact status header and primary scenario flow after load', async () => {
    fetchDgxResourceOverview.mockResolvedValue(makeOverview());
    fetchDgxResourceEvents.mockResolvedValue({ events: [] });

    renderWithClient(<DgxResourceDashboard />);

    expect(screen.getByRole('heading', { name: 'DGX リソース' })).toBeInTheDocument();

    expect(await screen.findByText('業務 Ready')).toBeInTheDocument();
    expect(screen.getByLabelText('DGX 運用状態サマリー')).toBeInTheDocument();
    expect(screen.getByText('問題なし')).toBeInTheDocument();
    expect(screen.getByText('Current State')).toBeInTheDocument();
    expect(screen.getByText('Model')).toBeInTheDocument();
    expect(screen.getByText('Memory')).toBeInTheDocument();
    expect(screen.getAllByText('GPU').length).toBeGreaterThan(0);
    expect(screen.getByText('Alerts')).toBeInTheDocument();
    expect(screen.getAllByText('27B').length).toBeGreaterThan(0);
    expect(screen.getAllByText('96 / 128 GiB').length).toBeGreaterThan(0);
    expect(screen.getAllByText('44%').length).toBeGreaterThan(0);
    expect(screen.getByText('46℃ / 11W')).toBeInTheDocument();
    expect(screen.getByText('なし')).toBeInTheDocument();
    expect(screen.getByText('詳細・保守・ログ')).toBeInTheDocument();
    expect(screen.getByText('primary-scenario-flow')).toBeInTheDocument();
  });

  it('renders all model profiles inside the maintenance section after expand', async () => {
    fetchDgxResourceOverview.mockResolvedValue(makeOverview());
    fetchDgxResourceEvents.mockResolvedValue({ events: [] });

    renderWithClient(<DgxResourceDashboard />);

    expect(await screen.findByText('業務 Ready')).toBeInTheDocument();
    const details = screen.getByText('詳細・保守・ログ').closest('details');
    expect(details).not.toHaveAttribute('open');
    expect(screen.getByLabelText('モデルプロファイル')).not.toBeVisible();

    fireEvent.click(screen.getByText('詳細・保守・ログ'));

    expect(details).toHaveAttribute('open');
    expect(await screen.findByLabelText('モデルプロファイル')).toBeVisible();
    expect(screen.getByText('Qwen3.5 35B GGUF')).toBeVisible();
    expect(screen.getByText('Ornith 1.0 35B NVFP4')).toBeVisible();
  });

  it('keeps maintenance panels collapsed until expanded and maintenance tab selected', async () => {
    fetchDgxResourceOverview.mockResolvedValue(makeOverview());
    fetchDgxResourceEvents.mockResolvedValue({ events: [] });

    renderWithClient(<DgxResourceDashboard />);
    expect(await screen.findByText('primary-scenario-flow')).toBeInTheDocument();
    expect(screen.queryByText('policy-panel')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('詳細・保守・ログ'));
    fireEvent.click(screen.getByRole('tab', { name: '保守' }));

    expect(screen.getByText('policy-panel')).toBeVisible();
    expect(screen.getByText('orchestration-panel')).toBeVisible();
    expect(screen.getByText('target-grid')).toBeVisible();
  });
});
