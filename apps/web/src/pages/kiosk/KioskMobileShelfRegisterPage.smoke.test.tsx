import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { KioskMobileShelfRegisterPage } from './KioskMobileShelfRegisterPage';

describe('KioskMobileShelfRegisterPage', () => {
  it('棚番登録画面を表示する', () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/kiosk/mobile-placement/shelf-register']}>
          <Routes>
            <Route path="/kiosk/mobile-placement/shelf-register" element={<KioskMobileShelfRegisterPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
    expect(screen.getByRole('button', { name: 'この棚番で登録' })).toBeDisabled();
    expect(screen.getByText('選択中')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '戻る' })).toBeInTheDocument();
  });
});
