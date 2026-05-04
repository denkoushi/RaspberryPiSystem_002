import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { KioskMobileZero2wAssignmentPage } from './KioskMobileZero2wAssignmentPage';

describe('KioskMobileZero2wAssignmentPage', () => {
  it('Zero2W 担当棚設定画面を表示する', () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/kiosk/mobile-placement/zero2w-assignment']}>
          <Routes>
            <Route
              path="/kiosk/mobile-placement/zero2w-assignment"
              element={<KioskMobileZero2wAssignmentPage />}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(screen.getByRole('button', { name: '戻る' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
    expect(screen.getByText('Zero2W担当棚設定')).toBeInTheDocument();
  });
});
