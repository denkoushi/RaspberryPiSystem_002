import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { MovedToKioskTagDeskPage } from './MovedToKioskTagDeskPage';

describe('moved position ranks page', () => {
  it('shows the kiosk tag desk destination at the old admin path', () => {
    render(<MemoryRouter initialEntries={['/admin/knowledge-position-ranks']}><Routes><Route path="/admin/knowledge-position-ranks" element={<MovedToKioskTagDeskPage positionRanks />} /></Routes></MemoryRouter>);
    expect(screen.getByText('キオスクの「タグ管理」に移りました')).toBeInTheDocument();
    expect(screen.getByText(/社員一覧の上部にある「職位の対応表」/)).toBeInTheDocument();
    expect(screen.getByText(/4桁の操作パスワード/)).toBeInTheDocument();
  });
});
