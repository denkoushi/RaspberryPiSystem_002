import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { KioskMobileShelfRegisterPage } from './KioskMobileShelfRegisterPage';

describe('KioskMobileShelfRegisterPage', () => {
  it('棚番登録画面を表示する', () => {
    render(
      <MemoryRouter initialEntries={['/kiosk/mobile-placement/shelf-register']}>
        <Routes>
          <Route path="/kiosk/mobile-placement/shelf-register" element={<KioskMobileShelfRegisterPage />} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByRole('heading', { name: '棚番を登録' })).toBeInTheDocument();
    expect(screen.getByText('選択中の棚番')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'この棚番で登録' })).toBeDisabled();
  });
});
