import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ConfirmProvider } from '../../../contexts/ConfirmContext';

import { DgxResourceProfilePanel } from './DgxResourceProfilePanel';

import type { DgxResourceOverview } from '../../../api/dgx-resource.types';
import type { ReactElement } from 'react';

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ConfirmProvider>{ui}</ConfirmProvider>
    </QueryClientProvider>
  );
}

describe('DgxResourceProfilePanel', () => {
  it('renders even when targets are absent for legacy overview compatibility', () => {
    const overview = {
      generatedAt: new Date().toISOString(),
      kpis: {
        gpuUtilPct: null,
        unifiedMemoryUsedGiB: null,
        unifiedMemoryTotalGiB: null,
        freeMemoryGiB: null,
        policyMode: 'business_first',
        policyLabel: '業務優先',
      },
      policy: {
        mode: 'business_first',
        previousMode: null,
        comfyStartBlockedHint: true,
      },
      runtime: {
        localLlmMode: 'on_demand',
        runtimeControlConfigured: true,
        warmWindow: { enabled: false },
      },
      optionalProbes: {
        metricsConfigured: false,
        comfyHealthConfigured: false,
        embeddingHealthConfigured: false,
        sparkHostConfigured: false,
        comfyRuntimeControlConfigured: false,
        experimentLabHealthConfigured: false,
        experimentLabRuntimeControlConfigured: false,
      },
      sparkHost: {
        configured: false,
        probedAt: new Date().toISOString(),
        status: 'unknown',
      },
      services: [
        {
          id: 'system-prod-inference',
          name: 'inference-backend (/v1/models)',
          status: 'degraded',
          badges: ['degraded'],
          metaLines: ['/v1/models -> 503'],
        },
      ],
      notes: [],
      monitoring: {
        activeInferenceSummary: null,
        sparkSummaryJa: 'テスト用',
        alerts: [],
        targetHighlights: [],
        lastScenarioFailure: null,
      },
    } satisfies Omit<DgxResourceOverview, 'targets'>;

    renderWithClient(
      <DgxResourceProfilePanel
        overview={overview as DgxResourceOverview}
        onControlUiError={() => undefined}
      />
    );

    expect(screen.getByText('運用プロファイル')).toBeInTheDocument();
    expect(screen.getByText(/推論レイヤが degraded の可能性があります/)).toBeInTheDocument();
  });
});
