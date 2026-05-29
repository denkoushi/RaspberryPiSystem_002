import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
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

vi.mock('./DgxResourceStatusBoard', () => ({
  DgxResourceStatusBoard: ({
    kpis,
    runtimeSummary,
  }: {
    kpis: DgxResourceOverview['kpis'];
    runtimeSummary?: DgxResourceOverview['runtimeSummary'];
  }) => (
    <div data-testid="status-board">
      gpu:{kpis.gpuUtilPct}
      policy:{runtimeSummary?.policyLabel ?? kpis.policyLabel}
    </div>
  ),
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
    },
  };
}

describe('DgxResourceDashboard', () => {
  beforeEach(() => {
    fetchDgxResourceOverview.mockReset();
    fetchDgxResourceEvents.mockReset();
    useConfirmMock.mockClear();
  });

  it('loaded state hides page heading and renders KPI strip first', async () => {
    fetchDgxResourceOverview.mockResolvedValue(makeOverview());
    fetchDgxResourceEvents.mockResolvedValue({ events: [] });

    renderWithClient(<DgxResourceDashboard />);

    expect(screen.getByRole('heading', { name: 'DGX リソース' })).toBeInTheDocument();

    expect(await screen.findByTestId('status-board')).toHaveTextContent('policy:業務優先');
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'DGX リソース' })).toBeNull();
    });
    expect(screen.getByText('primary-scenario-flow')).toBeInTheDocument();
  });
});
