import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DgxResourceTargetGrid } from './DgxResourceTargetGrid';

import type { DgxResourceOverview } from '../../../api/dgx-resource.types';

function makeOverview(): DgxResourceOverview {
  return {
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
      comfyHealthConfigured: true,
      embeddingHealthConfigured: false,
      sparkHostConfigured: false,
      comfyRuntimeControlConfigured: true,
      experimentLabHealthConfigured: false,
      experimentLabRuntimeControlConfigured: false,
    },
    targets: [
      {
        id: 'system-prod-gateway',
        kind: 'gateway',
        displayName: 'system-prod-gateway',
        capabilities: ['readStatus', 'start', 'stop'],
        status: 'running',
        badges: [],
        metaLines: ['gateway: http://127.0.0.1:38081'],
      },
      {
        id: 'private-comfyui',
        kind: 'http_probe',
        displayName: 'private-comfyui',
        capabilities: ['readStatus', 'start', 'stop'],
        status: 'stopped',
        badges: [],
        metaLines: ['runtime: POST start/stop'],
      },
      {
        id: 'metrics-kpi',
        kind: 'metrics_source',
        displayName: 'GPU/メモリ KPI',
        capabilities: ['readStatus'],
        status: 'unknown',
        badges: [],
        metaLines: ['未設定'],
      },
    ],
    sparkHost: {
      configured: false,
      probedAt: new Date().toISOString(),
      status: 'unknown',
    },
    services: [],
    notes: [],
  };
}

describe('DgxResourceTargetGrid', () => {
  it('shows contextual error on the matching target card only', () => {
    render(
      <DgxResourceTargetGrid
        targets={makeOverview().targets ?? []}
        overview={makeOverview()}
        targetActionError={{
          targetId: 'private-comfyui',
          message: 'private-comfyui の停止に失敗しました',
        }}
        onControlUiError={() => undefined}
        confirmStop={vi.fn(async () => true)}
        busy={false}
        onExecuteTarget={() => undefined}
      />
    );

    expect(screen.getByText('private-comfyui の停止に失敗しました')).toBeInTheDocument();
    expect(screen.getAllByText('起動')).toHaveLength(2);
    expect(screen.getAllByText('停止')).toHaveLength(2);
  });

  it('keeps read-only cards free from control buttons', () => {
    render(
      <DgxResourceTargetGrid
        targets={makeOverview().targets ?? []}
        overview={makeOverview()}
        targetActionError={null}
        onControlUiError={() => undefined}
        confirmStop={vi.fn(async () => true)}
        busy={false}
        onExecuteTarget={() => undefined}
      />
    );

    const metricsCard = screen.getByText('GPU/メモリ KPI').closest('section');
    expect(metricsCard).not.toBeNull();
    expect(within(metricsCard as HTMLElement).queryByRole('button', { name: '起動' })).toBeNull();
    expect(within(metricsCard as HTMLElement).queryByRole('button', { name: '停止' })).toBeNull();
    expect(screen.getAllByText('起動')).toHaveLength(2);
  });
});
