import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DgxResourceQuickProfileActions } from './DgxResourceQuickProfileActions';
import { DGX_QUICK_START_MODEL_PROFILE_ID } from './dgxResourceQuickProfileConfig';

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
      id: DGX_QUICK_START_MODEL_PROFILE_ID,
      displayNameJa: DGX_QUICK_START_MODEL_PROFILE_ID,
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

  it('posts START_MODEL_PROFILE when quick button is confirmed', async () => {
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

    fireEvent.click(screen.getByRole('button', { name: DGX_QUICK_START_MODEL_PROFILE_ID }));

    await waitFor(() => {
      expect(postDgxAction).toHaveBeenCalledWith({
        type: 'START_MODEL_PROFILE',
        modelProfileId: DGX_QUICK_START_MODEL_PROFILE_ID,
        reason: 'admin_dgx_resource_quick_profile',
      });
    });
  });

  it('disables button when profile is not available', () => {
    renderWithClient(
      <DgxResourceQuickProfileActions
        modelProfiles={{ ...modelProfiles, available: [] }}
        postDgxAction={vi.fn()}
        actionBusy={false}
        onControlUiError={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: DGX_QUICK_START_MODEL_PROFILE_ID })).toBeDisabled();
  });
});
