import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DgxResourcePrimaryScenarioFlow } from './DgxResourcePrimaryScenarioFlow';

import type {
  DgxResourceActionBody,
  DgxResourceActionResult,
  DgxResourceOperatorConsoleApi,
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
      postDgxAction,
      actionBusy: false,
      onControlUiError: vi.fn(),
    };

    const first = renderWithClient(<DgxResourcePrimaryScenarioFlow {...props} />);

    fireEvent.click(await screen.findByRole('button', { name: '実行する →' }));

    await waitFor(() => {
      expect(postDgxAction).toHaveBeenCalledWith({
        type: 'EXECUTE_ORCHESTRATION_SCENARIO',
        scenarioId: 'private_to_business',
        planFingerprint: 'f'.repeat(64),
        confirmed: true,
      });
    });

    first.unmount();
    renderWithClient(<DgxResourcePrimaryScenarioFlow {...props} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '実行する →' })).toBeDisabled();
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
      expect(screen.getByRole('button', { name: '実行する →' })).not.toBeDisabled();
    });
  });
});
