import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ConfirmProvider } from '../../../contexts/ConfirmContext';

import { DgxResourceOrchestrationPanel } from './DgxResourceOrchestrationPanel';

import type { DgxResourceUiMetadataApi } from '../../../api/dgx-resource.types';
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

const apiUiMetadata: DgxResourceUiMetadataApi = {
  scenarios: [
    {
      id: 'business_to_private',
      titleJa: 'API提供: 私用を始める',
      descriptionJa: 'API提供: 説明文',
      cautionsJa: [],
    },
    {
      id: 'private_to_business',
      titleJa: '業務に戻す（私用終了）',
      descriptionJa: '必要な停止試行の後、「業務優先」へ戻します。',
      cautionsJa: [],
    },
    {
      id: 'business_to_experiment',
      titleJa: '実験を始める',
      descriptionJa: '調停後「実験優先」。業務 Inference との競合に注意してください。',
      cautionsJa: [],
    },
    {
      id: 'experiment_to_business',
      titleJa: '実験を終えて業務に戻す',
      descriptionJa: '調停で停止試行後、「業務優先」へ戻します。',
      cautionsJa: [],
    },
  ],
  policyModes: [],
};

describe('DgxResourceOrchestrationPanel uiMetadata precedence', () => {
  it('prefers API-provided scenario title over local fallback', () => {
    renderWithClient(
      <DgxResourceOrchestrationPanel onControlUiError={() => undefined} overview={{ uiMetadata: apiUiMetadata }} />
    );

    expect(screen.getByRole('button', { name: 'API提供: 私用を始める' })).toBeInTheDocument();
    expect(screen.getByText(/API提供: 説明文/)).toBeInTheDocument();
  });
});
