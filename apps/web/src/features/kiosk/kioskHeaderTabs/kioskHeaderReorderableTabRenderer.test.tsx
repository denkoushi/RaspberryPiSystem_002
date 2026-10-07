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

  it('renders the inventory tab pointing at the daily inventory screen', () => {
    render(
      <MemoryRouter>
        {renderKioskReorderableHeaderTab('inventory_settings', baseContext)}
      </MemoryRouter>
    );

    expect(screen.getByRole('link', { name: '在庫' })).toHaveAttribute('href', '/kiosk/inventory');
  });

  it('keeps the inventory tab active on the setup screen', () => {
    render(
      <MemoryRouter>
        {renderKioskReorderableHeaderTab('inventory_settings', { ...baseContext, pathname: '/kiosk/inventory/settings' })}
      </MemoryRouter>
    );

    expect(screen.getByRole('link', { name: '在庫' })).toHaveClass('bg-inv-cyan', 'text-inv-cyan-ink', 'font-bold');
    expect(screen.getByRole('link', { name: '在庫' })).toHaveAttribute('aria-current', 'page');
  });

  it.each([
    ['borrow', '/kiosk/photo', '持出'],
    ['assembly', '/kiosk/assembly/manuals', '組立'],
    ['rigging_analytics', '/kiosk/rigging-analytics', '集計'],
    ['due_management', '/kiosk/production-schedule/due-management', '納期管理'],
    ['call', '/kiosk/call', '通話']
  ] as const)('uses the common selected style and aria-current for %s', (tabId, pathname, label) => {
    render(<MemoryRouter>{renderKioskReorderableHeaderTab(tabId, { ...baseContext, pathname })}</MemoryRouter>);
    const tab = screen.getByRole(tabId === 'due_management' ? 'button' : 'link', { name: label });
    expect(tab).toHaveClass('bg-inv-cyan', 'text-inv-cyan-ink', 'font-bold');
    expect(tab).toHaveAttribute('aria-current', 'page');
    expect(tab).not.toHaveAttribute('style');
  });

  it('keeps visual and aria selection based on the existing condition even when the link destination differs', () => {
    render(<MemoryRouter initialEntries={['/kiosk/part-measurement/inspection']}>
      {renderKioskReorderableHeaderTab('part_measurement', { ...baseContext, pathname: '/kiosk/part-measurement/inspection' })}
    </MemoryRouter>);
    expect(screen.getByRole('link', { name: '部品測定' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: '部品測定' })).not.toHaveClass('bg-inv-cyan');
  });
});
