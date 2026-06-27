import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DgxResourceQuickProfileActions } from './DgxResourceQuickProfileActions';

import type {
  DgxModelProfilesOverviewApi,
  DgxResourceActionBody,
  DgxResourceActionResult,
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
      backend: 'green',
      servedAlias: 'system-prod-primary',
      recommended: false,
      enabled: true,
      status: 'available',
      canonicalNames: [],
      legacyNames: [],
    },
  ],
};

describe('DgxResourceQuickProfileActions', () => {
  beforeEach(() => {
    confirmMock.mockClear();
  });

  it('posts START_MODEL_PROFILE for profiles returned by DGX', async () => {
    const postDgxAction = vi.fn(
      async (_body: DgxResourceActionBody): Promise<DgxResourceActionResult> => ({
        ok: true,
        message: 'ok',
      })
    );

    renderWithClient(
      <DgxResourceQuickProfileActions
        modelProfiles={modelProfiles}
        postDgxAction={postDgxAction}
        actionBusy={false}
        onControlUiError={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Qwen3.6 27B NVFP4' }));

    await waitFor(() => {
      expect(postDgxAction).toHaveBeenCalledWith({
        type: 'START_MODEL_PROFILE',
        modelProfileId: 'business_qwen36_27b_nvfp4',
        reason: 'admin_dgx_resource_quick_profile',
      });
    });
  });

  it('shows empty state when no profile is startable', () => {
    renderWithClient(
      <DgxResourceQuickProfileActions
        modelProfiles={{ ...modelProfiles, available: [] }}
        postDgxAction={vi.fn()}
        actionBusy={false}
        onControlUiError={vi.fn()}
      />
    );

    expect(screen.getByText('起動可能なモデルなし')).toBeInTheDocument();
  });
});
