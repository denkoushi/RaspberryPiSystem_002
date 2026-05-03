import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { DgxResourceOrchestrationPanel } from './DgxResourceOrchestrationPanel';

const { postDgxResourceAction, confirmMock } = vi.hoisted(() => ({
  postDgxResourceAction: vi.fn(),
  confirmMock: vi.fn(async () => true),
}));

vi.mock('../../../api/dgx-resource', () => ({
  dgxResourceQueryKeys: {
    overview: ['dgx-resource', 'overview'],
    events: (limit: number) => ['dgx-resource', 'events', limit],
  },
  getDgxResourceApiErrorMessage: (error: unknown) => (error instanceof Error ? error.message : 'error'),
  postDgxResourceAction,
}));

vi.mock('../../../contexts/ConfirmContext', () => ({
  useConfirm: () => confirmMock,
}));

function renderWithClient() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <DgxResourceOrchestrationPanel onControlUiError={() => undefined} />
    </QueryClientProvider>
  );
}

describe('DgxResourceOrchestrationPanel', () => {
  beforeEach(() => {
    postDgxResourceAction.mockReset();
    confirmMock.mockClear();
  });

  it('renders preview steps returned from API', async () => {
    postDgxResourceAction.mockResolvedValueOnce({
      ok: true,
      message: 'プレビュー取得',
      scenarioPreview: {
        scenarioId: 'business_to_private',
        targetPolicyMode: 'private_ok',
        applyWorkloadChanges: false,
        planFingerprint: 'a'.repeat(64),
        steps: [
          {
            kind: 'policy',
            order: 1,
            policyMode: 'private_ok',
            summaryJa: '運用プロファイルを「私用OK」へ適用します',
          },
        ],
        warnings: ['注意事項'],
      },
    });

    renderWithClient();
    fireEvent.click(screen.getByRole('button', { name: 'プレビュー取得' }));

    expect(await screen.findByText('運用プロファイルを「私用OK」へ適用します')).toBeInTheDocument();
    expect(screen.getByText(/実行計画 ID（指紋）/)).toBeInTheDocument();
    expect(screen.getByText(/注意事項/)).toBeInTheDocument();
  });

  it('shows execute summary including completed steps and next action', async () => {
    postDgxResourceAction
      .mockResolvedValueOnce({
        ok: true,
        message: 'プレビュー取得',
        scenarioPreview: {
          scenarioId: 'business_to_private',
          targetPolicyMode: 'private_ok',
          applyWorkloadChanges: false,
          planFingerprint: 'b'.repeat(64),
          steps: [
            {
              kind: 'policy',
              order: 1,
              policyMode: 'private_ok',
              summaryJa: '運用プロファイルを「私用OK」へ適用します',
            },
          ],
          warnings: [],
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        message: '途中停止しました',
        scenarioExecute: {
          scenarioId: 'business_to_private',
          success: false,
          completedStepOrders: [1, 2],
          completedPolicyApplied: false,
          failureMessageJa: 'runtime stop failed',
          recommendedNextJa: 'Control Targets を確認してください',
        },
      });

    renderWithClient();
    fireEvent.click(screen.getByRole('button', { name: 'プレビュー取得' }));
    await screen.findByText('運用プロファイルを「私用OK」へ適用します');

    fireEvent.click(screen.getByRole('button', { name: 'この内容で実行する' }));

    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('実行結果: 部分成功または失敗')).toBeInTheDocument();
    expect(screen.getByText(/完了 step order: 1, 2/)).toBeInTheDocument();
    expect(screen.getByText(/次の確認: Control Targets を確認してください/)).toBeInTheDocument();
  });
});
