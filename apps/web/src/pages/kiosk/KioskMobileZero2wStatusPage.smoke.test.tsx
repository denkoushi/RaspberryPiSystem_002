import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { KioskMobileZero2wStatusPage } from './KioskMobileZero2wStatusPage';

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return {
    ...actual,
    getMobilePlacementHaizenCurrent: vi.fn().mockResolvedValue({ rows: [] })
  };
});

describe('KioskMobileZero2wStatusPage', () => {
  it('Zero2W 配膳一覧ページを表示する', () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/kiosk/mobile-placement/zero2w-status']}>
          <Routes>
            <Route path="/kiosk/mobile-placement/zero2w-status" element={<KioskMobileZero2wStatusPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(screen.getByRole('button', { name: '戻る' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Zero2W 棚番配膳の状態' })).toBeInTheDocument();
  });
});
