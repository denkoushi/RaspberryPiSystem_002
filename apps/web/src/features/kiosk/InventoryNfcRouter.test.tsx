import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { InventoryNfcRouter } from './InventoryNfcRouter';

vi.mock('../../hooks/useNfcStream', () => ({
  useNfcStream: vi.fn(() => ({ uid: 'item-uid', timestamp: '2026-09-17T00:00:00.000Z', eventId: 1 })),
}));

vi.mock('../../api/hooks/item-inventory', () => ({ useInventoryTags: vi.fn() }));

function Driver() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output data-testid="path">{location.pathname}</output>
      <button type="button" onClick={() => navigate('/kiosk/inventory/settings')}>設定へ</button>
      <InventoryNfcRouter />
    </>
  );
}

describe('InventoryNfcRouter', () => {
  it('does not replay the same scan when navigating to another tab', async () => {
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={['/kiosk']}><Driver /></MemoryRouter></QueryClientProvider>);
    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/kiosk/inventory'));

    fireEvent.click(screen.getByRole('button', { name: '設定へ' }));
    expect(screen.getByTestId('path')).toHaveTextContent('/kiosk/inventory/settings');
  });
});
