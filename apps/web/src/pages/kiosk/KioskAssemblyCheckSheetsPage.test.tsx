import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { KioskAssemblyCheckSheetsPage } from './KioskAssemblyCheckSheetsPage';

import type { ReactNode } from 'react';

vi.mock('../../features/assembly/checkSheet/CheckSheetLibraryPage', () => ({
  CheckSheetLibraryPage: ({ backLink }: { backLink: ReactNode }) => <header>{backLink}<h1>組立チェックシート</h1></header>
}));

describe('KioskAssemblyCheckSheetsPage', () => {
  it('opens the library with a return link to assembly', () => {
    render(<MemoryRouter><KioskAssemblyCheckSheetsPage /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: '組立チェックシート' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '組立へ戻る' }).closest('header')).toContainElement(screen.getByRole('heading'));
    expect(screen.getByRole('link', { name: '組立へ戻る' })).toHaveAttribute('href', '/kiosk/assembly');
  });
});
