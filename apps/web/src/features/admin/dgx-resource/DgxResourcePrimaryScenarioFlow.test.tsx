import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DgxResourcePrimaryScenarioFlow } from './DgxResourcePrimaryScenarioFlow';

import type {
  DgxResourceActionBody,
  DgxResourceActionResult,
  DgxModelProfilesOverviewApi,
  DgxResourceOperatorConsoleApi,
  DgxResourceRuntimeSummaryApi,
} from '../../../api/dgx-resource.types';
import type { ReactElement } from 'react';

const { confirmMock } = vi.hoisted(() => ({
  confirmMock: vi.fn(async () => true),
}));

vi.mock('../../../contexts/ConfirmContext', () => ({
  useConfirm: () => confirmMock,
}));

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function makeOperator(): DgxResourceOperatorConsoleApi {
  return {
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
    operatorActions: [
      {
        id: 'private_to_business',
        labelJa: '業務用に戻す',
        subtitleJa: '私用を停止して業務優先へ戻します',
        scenarioId: 'private_to_business',
        primary: true,
      },
    ],
  };
}

const modelProfiles: DgxModelProfilesOverviewApi = {
  configured: true,
  status: 'ok',
  activeProfileId: null,
  activeStateBackend: null,
  pendingProfileId: null,
  lastLoadedProfileId: null,
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
  ],
};

function runtimeSummary(partial: Partial<DgxResourceRuntimeSummaryApi>): DgxResourceRuntimeSummaryApi {
  return {
    activeProfileId: null,
    activeProfileDisplayNameJa: null,
    activeBackend: null,
    businessReady: false,
    businessReadyDetailJa: 'not ready',
    policyMode: 'business_first',
    policyLabel: '業務優先',
    runtimeSource: 'unknown',
    inferenceDegraded: true,
    resourceOwner: 'business',
    resourceOwnerLabelJa: '業務',
    resourceStateStatus: 'preparing',
    resourceStateDetailJa: 'preparing',
    ...partial,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('DgxResourcePrimaryScenarioFlow', () => {
  beforeEach(() => {
    confirmMock.mockClear();
    window.sessionStorage.clear();
  });

  it('keeps execution busy across unmount/remount while execute request is pending', async () => {
    const operator = makeOperator();
    const execDeferred = deferred<DgxResourceActionResult>();
    const postDgxAction = vi.fn(async (body: DgxResourceActionBody): Promise<DgxResourceActionResult> => {
      if (body.type === 'PREVIEW_ORCHESTRATION_SCENARIO') {
        return {
          ok: true,
          message: 'preview',
          scenarioPreview: {
            scenarioId: 'private_to_business',
            targetPolicyMode: 'business_first',
            applyWorkloadChanges: true,
            planFingerprint: 'f'.repeat(64),
            steps: [],
            warnings: [],
          },
        };
      }
      if (body.type === 'EXECUTE_ORCHESTRATION_SCENARIO') {
        return execDeferred.promise;
      }
      return { ok: true, message: 'ok' };
    });

    const props = {
      operator,
      modelProfiles,
      postDgxAction,
      actionBusy: false,
      onControlUiError: vi.fn(),
    };

    const first = renderWithClient(<DgxResourcePrimaryScenarioFlow {...props} />);

    fireEvent.click(await screen.findByRole('button', { name: '業務用に戻す' }));

    await waitFor(() => {
      expect(postDgxAction).toHaveBeenCalledWith({
        type: 'EXECUTE_ORCHESTRATION_SCENARIO',
        scenarioId: 'private_to_business',
        modelProfileId: 'business_qwen36_27b_nvfp4',
        planFingerprint: 'f'.repeat(64),
        confirmed: true,
      });
    });

    first.unmount();
    renderWithClient(<DgxResourcePrimaryScenarioFlow {...props} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '業務用に戻す' })).toBeDisabled();
    });

    execDeferred.resolve({
      ok: true,
      message: 'done',
      scenarioExecute: {
        scenarioId: 'private_to_business',
        success: true,
        completedStepOrders: [1, 2],
        completedPolicyApplied: true,
      },
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '業務用に戻す' })).not.toBeDisabled();
    });
  });

  it('does not list businessOrchestrationEligible=false profiles in business return select', () => {
    const operator = makeOperator();
    const profilesWithUncensored: DgxModelProfilesOverviewApi = {
      ...modelProfiles,
      available: [
        ...modelProfiles.available,
        {
          id: 'qwen36_35b_uncensored',
          displayNameJa: 'qwen36_35b_uncensored',
          backend: 'green',
          servedAlias: 'system-prod-primary',
          recommended: false,
          businessOrchestrationEligible: false,
          enabled: true,
          status: 'available',
          canonicalNames: [],
          legacyNames: [],
        },
      ],
      businessReturnSelectable: modelProfiles.available,
    };

    renderWithClient(
      <DgxResourcePrimaryScenarioFlow
        operator={operator}
        modelProfiles={profilesWithUncensored}
        postDgxAction={vi.fn()}
        actionBusy={false}
        onControlUiError={vi.fn()}
      />
    );

    expect(screen.getByRole('option', { name: /Qwen3\.6 27B NVFP4/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'qwen36_35b_uncensored' })).not.toBeInTheDocument();
  });

  it('keeps business return pending after in_progress and clears when overview reports ready', async () => {
    const operator = makeOperator();
    const postDgxAction = vi.fn(async (body: DgxResourceActionBody): Promise<DgxResourceActionResult> => {
      if (body.type === 'PREVIEW_ORCHESTRATION_SCENARIO') {
        return {
          ok: true,
          message: 'preview',
          scenarioPreview: {
            scenarioId: 'private_to_business',
            targetPolicyMode: 'business_first',
            applyWorkloadChanges: true,
            planFingerprint: 'f'.repeat(64),
            steps: [],
            warnings: [],
          },
        };
      }
      if (body.type === 'EXECUTE_ORCHESTRATION_SCENARIO') {
        return {
          ok: true,
          message:
            '復帰処理を開始しました。DGX 側でモデルをロード中です。\nReady まで数分かかることがあります。画面を閉じても処理は継続します。',
          scenarioExecute: {
            scenarioId: 'private_to_business',
            success: true,
            completedStepOrders: [1, 2],
            completedPolicyApplied: true,
            outcomeKind: 'in_progress',
            readinessSummaryJa:
              '復帰処理を開始しました。DGX 側でモデルをロード中です。\nReady まで数分かかることがあります。画面を閉じても処理は継続します。',
          },
        };
      }
      return { ok: true, message: 'ok' };
    });

    const props = {
      operator,
      modelProfiles,
      postDgxAction,
      actionBusy: false,
      onControlUiError: vi.fn(),
    };

    const first = renderWithClient(
      <DgxResourcePrimaryScenarioFlow
        {...props}
        runtimeSummary={runtimeSummary({ businessReady: false, resourceStateStatus: 'preparing' })}
      />
    );

    fireEvent.click(await screen.findByRole('button', { name: '業務用に戻す' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '業務用に戻す' })).toBeDisabled();
    });
    expect(screen.getAllByText(/DGX 側でモデルをロード/).length).toBeGreaterThan(0);
    expect(window.sessionStorage.getItem('dgx-resource:primary-scenario-pending')).toContain('private_to_business');

    first.unmount();
    renderWithClient(
      <DgxResourcePrimaryScenarioFlow
        {...props}
        runtimeSummary={runtimeSummary({ businessReady: true, resourceStateStatus: 'ready', inferenceDegraded: false })}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '業務用に戻す' })).not.toBeDisabled();
    });
    expect(window.sessionStorage.getItem('dgx-resource:primary-scenario-pending')).toBeNull();
  });
});
