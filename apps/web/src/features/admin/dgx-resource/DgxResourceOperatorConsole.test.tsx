import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ConfirmProvider } from '../../../contexts/ConfirmContext';

import { DgxResourceOperatorConsole } from './DgxResourceOperatorConsole';

import type { DgxResourceOperatorConsoleApi, DgxResourceOverview } from '../../../api/dgx-resource.types';
import type { ReactElement } from 'react';

function renderWithProviders(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ConfirmProvider>{ui}</ConfirmProvider>
    </QueryClientProvider>
  );
}

function makeOperator(): DgxResourceOperatorConsoleApi {
  return {
    workloads: [
      {
        id: 'business_vlm',
        labelJa: '業務 VLM',
        purposeJa: 'test',
        risk: 'low',
        status: 'running',
        statusHeadlineJa: 'Gateway: 稼働',
        relatedTargetIds: ['system-prod-gateway'],
        runtimeControlConfigured: true,
      },
      {
        id: 'private_comfy',
        labelJa: '私用 ComfyUI',
        purposeJa: 'test',
        risk: 'low',
        status: 'stopped',
        statusHeadlineJa: 'ComfyUI: 停止',
        relatedTargetIds: ['private-comfyui'],
        runtimeControlConfigured: true,
      },
      {
        id: 'experiment_lab',
        labelJa: '実験ラボ',
        purposeJa: 'test',
        risk: 'medium',
        status: 'unknown',
        statusHeadlineJa: 'experiment-lab: 不明',
        relatedTargetIds: ['experiment-lab'],
        runtimeControlConfigured: false,
      },
    ],
    operatorSummary: {
      headlineJa: '現在の運用プロファイルは「業務優先」です。',
      policyMode: 'business_first',
      policyLabelJa: '業務優先',
      previousMode: null,
      previousPolicyLabelJa: null,
      comfyStartBlockedHint: true,
      inferenceSparkLineJa: null,
      alertPreviewJa: [],
    },
    operatorActions: [
      {
        id: 'business_to_private',
        labelJa: '私用を始める',
        subtitleJa: 'sub',
        scenarioId: 'business_to_private',
        primary: true,
      },
      {
        id: 'private_to_business',
        labelJa: '業務に戻す（私用を終える）',
        subtitleJa: 'sub',
        scenarioId: 'private_to_business',
        primary: false,
      },
      {
        id: 'business_to_experiment',
        labelJa: '実験へ',
        subtitleJa: 'sub',
        scenarioId: 'business_to_experiment',
        primary: false,
      },
      {
        id: 'experiment_to_business',
        labelJa: '実験から戻す',
        subtitleJa: 'sub',
        scenarioId: 'experiment_to_business',
        primary: false,
      },
    ],
  };
}

function makeOverview(operator: DgxResourceOperatorConsoleApi): DgxResourceOverview {
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
      comfyHealthConfigured: false,
      embeddingHealthConfigured: false,
      sparkHostConfigured: false,
      comfyRuntimeControlConfigured: true,
      experimentLabHealthConfigured: false,
      experimentLabRuntimeControlConfigured: false,
    },
    targets: [],
    sparkHost: { configured: false, probedAt: new Date().toISOString(), status: 'unknown' },
    services: [],
    notes: [],
    monitoring: {
      activeInferenceSummary: null,
      sparkSummaryJa: 'x',
      alerts: [],
      targetHighlights: [],
      lastScenarioFailure: null,
    },
    operator,
  };
}

describe('DgxResourceOperatorConsole', () => {
  it('renders workloads and primary guide actions', () => {
    const op = makeOperator();
    renderWithProviders(
      <DgxResourceOperatorConsole
        overview={makeOverview(op)}
        operator={op}
        postDgxAction={vi.fn(async () => ({ ok: true, message: 'ok' }))}
        actionBusy={false}
        onControlUiError={() => undefined}
      />
    );

    expect(screen.getByRole('heading', { name: 'DGX 運用ガイド' })).toBeInTheDocument();
    expect(screen.getByText('業務 VLM')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'いまやりたいこと（推奨）' })).toBeInTheDocument();
    expect(screen.getByText('私用を始める')).toBeInTheDocument();
  });

  it('does not call preview when only selecting a scenario (explicit preview button)', async () => {
    const postDgxAction = vi.fn(async () => ({ ok: true as const, message: 'ok' }));
    const op = makeOperator();
    renderWithProviders(
      <DgxResourceOperatorConsole
        overview={makeOverview(op)}
        operator={op}
        postDgxAction={postDgxAction}
        actionBusy={false}
        onControlUiError={() => undefined}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /業務に戻す/ }));
    expect(postDgxAction).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /プレビュー(取得|再取得)/ }));
    await waitFor(() =>
      expect(postDgxAction).toHaveBeenCalledWith({
        type: 'PREVIEW_ORCHESTRATION_SCENARIO',
        scenarioId: 'private_to_business',
      })
    );
  });

  it('falls back to an available scenario when the current selection becomes disabled', async () => {
    const postDgxAction = vi.fn(async () => ({ ok: true as const, message: 'ok' }));
    const initial = makeOperator();
    const updated: DgxResourceOperatorConsoleApi = {
      ...initial,
      operatorSummary: {
        ...initial.operatorSummary,
        policyMode: 'private_ok',
        policyLabelJa: '私用OK',
      },
      operatorActions: initial.operatorActions.map((action) =>
        action.scenarioId === 'business_to_private'
          ? { ...action, disabledReasonJa: 'すでに「私用OK」です', primary: false }
          : action.scenarioId === 'private_to_business'
            ? { ...action, primary: true }
            : action
      ),
    };

    const { rerender } = renderWithProviders(
      <DgxResourceOperatorConsole
        overview={makeOverview(initial)}
        operator={initial}
        postDgxAction={postDgxAction}
        actionBusy={false}
        onControlUiError={() => undefined}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /プレビュー(取得|再取得)/ }));
    await waitFor(() =>
      expect(postDgxAction).toHaveBeenCalledWith({
        type: 'PREVIEW_ORCHESTRATION_SCENARIO',
        scenarioId: 'business_to_private',
      })
    );

    rerender(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}
      >
        <ConfirmProvider>
          <DgxResourceOperatorConsole
            overview={makeOverview(updated)}
            operator={updated}
            postDgxAction={postDgxAction}
            actionBusy={false}
            onControlUiError={() => undefined}
          />
        </ConfirmProvider>
      </QueryClientProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: /プレビュー(取得|再取得)/ }));
    await waitFor(() =>
      expect(postDgxAction).toHaveBeenLastCalledWith({
        type: 'PREVIEW_ORCHESTRATION_SCENARIO',
        scenarioId: 'private_to_business',
      })
    );
  });
});
