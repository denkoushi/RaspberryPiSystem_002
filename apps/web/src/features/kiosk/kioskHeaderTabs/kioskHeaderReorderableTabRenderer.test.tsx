import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import {
  renderKioskReorderableHeaderTab,
  resolveKioskBorrowHeaderTabPath,
  type KioskHeaderReorderableTabContext
} from './kioskHeaderReorderableTabRenderer';

const baseContext: KioskHeaderReorderableTabContext = {
  pathname: '/kiosk/assembly',
  onDueManagementNavigate: vi.fn(),
  dueManagementPending: false
};

describe('kiosk header reorderable tabs', () => {
  it('resolves the borrow tab to concrete borrow paths instead of the kiosk entry path', () => {
    expect(resolveKioskBorrowHeaderTabPath('TAG')).toBe('/kiosk/tag');
    expect(resolveKioskBorrowHeaderTabPath('PHOTO')).toBe('/kiosk/photo');
    expect(resolveKioskBorrowHeaderTabPath(undefined)).toBe('/kiosk/tag');
  });

  it('renders the borrow tab as /kiosk/tag for TAG default mode', () => {
    render(
      <MemoryRouter>
        {renderKioskReorderableHeaderTab('borrow', { ...baseContext, defaultMode: 'TAG' })}
      </MemoryRouter>
    );

    expect(screen.getByRole('link', { name: '持出' })).toHaveAttribute('href', '/kiosk/tag');
  });

  it('renders the borrow tab as /kiosk/photo for PHOTO default mode', () => {
    render(
      <MemoryRouter>
        {renderKioskReorderableHeaderTab('borrow', { ...baseContext, defaultMode: 'PHOTO' })}
      </MemoryRouter>
    );

    expect(screen.getByRole('link', { name: '持出' })).toHaveAttribute('href', '/kiosk/photo');
  });
});
