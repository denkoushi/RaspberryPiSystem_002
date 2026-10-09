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

    expect(screen.getByRole('link', { name: '開始ページ 持出' })).toHaveAttribute('href', '/kiosk/tag');
  });

  it('renders the borrow tab as /kiosk/photo for PHOTO default mode', () => {
    render(
      <MemoryRouter>
        {renderKioskReorderableHeaderTab('borrow', { ...baseContext, defaultMode: 'PHOTO' })}
      </MemoryRouter>
    );

    expect(screen.getByRole('link', { name: '開始ページ 持出' })).toHaveAttribute('href', '/kiosk/photo');
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
    ['borrow', '/kiosk/tag', '持出'],
    ['assembly', '/kiosk/assembly/manuals', '組立'],
    ['rigging_analytics', '/kiosk/rigging-analytics', '集計'],
    ['due_management', '/kiosk/production-schedule/due-management', '納期管理'],
    ['call', '/kiosk/call', '通話']
  ] as const)('uses the common selected style and aria-current for %s', (tabId, pathname, label) => {
    render(<MemoryRouter>{renderKioskReorderableHeaderTab(tabId, { ...baseContext, pathname })}</MemoryRouter>);
    const tab = screen.getByRole(tabId === 'due_management' ? 'button' : 'link', { name: tabId === 'borrow' ? `開始ページ ${label}` : label });
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

describe('startup page tab markers and route parity', () => {
  it.each([
    ['assembly', '/kiosk/assembly', true],
    ['assembly', '/kiosk/documents', false],
    ['borrow_photo', '/kiosk/photo', true],
    ['borrow_tag', '/kiosk/assembly', false]
  ] as const)('marks %s with the filled home and accessible label', (route, pathname, active) => {
    const tabId = route.startsWith('borrow_') ? 'borrow' : 'assembly';
    render(<MemoryRouter>{renderKioskReorderableHeaderTab(tabId, { ...baseContext, pathname, initialKioskRoute: route })}</MemoryRouter>);
    const link = screen.getByRole('link', { name: /開始ページ/ });
    expect(link.querySelector('svg')).toHaveAttribute('fill', 'currentColor');
    expect(link.querySelector('svg')).toHaveClass(active ? 'text-inv-cyan-ink' : 'text-inv-cyan');
  });

  it.each(['TAG', 'PHOTO'] as const)('marks the borrow fallback for unset %s devices', (defaultMode) => {
    render(<MemoryRouter>{renderKioskReorderableHeaderTab('borrow', { ...baseContext, defaultMode, initialKioskRoute: null })}</MemoryRouter>);
    expect(screen.getByRole('link', { name: '開始ページ 持出' })).toHaveAttribute('href', defaultMode === 'PHOTO' ? '/kiosk/photo' : '/kiosk/tag');
  });

  it.each([
    ['PHOTO', 'borrow_tag', '/kiosk/photo', false],
    ['PHOTO', 'borrow_tag', '/kiosk/tag', true],
    ['PHOTO', 'borrow_tag', '/kiosk/assembly', false],
    ['TAG', 'borrow_photo', '/kiosk/tag', false],
    ['TAG', 'borrow_photo', '/kiosk/photo', true],
    ['TAG', 'borrow_photo', '/kiosk/assembly', false]
  ] as const)('marks the borrow tab on a %s device with %s at %s only when it leads to the start page', (defaultMode, route, pathname, marked) => {
    render(<MemoryRouter>{renderKioskReorderableHeaderTab('borrow', { ...baseContext, defaultMode, pathname, initialKioskRoute: route })}</MemoryRouter>);
    expect(screen.getByRole('link', { name: marked ? '開始ページ 持出' : '持出' })).toBeInTheDocument();
  });

  it('does not mark another tab', () => {
    render(<MemoryRouter>{renderKioskReorderableHeaderTab('documents', { ...baseContext, initialKioskRoute: 'assembly' })}</MemoryRouter>);
    expect(screen.getByRole('link', { name: '要領書' }).querySelector('svg')).toBeNull();
  });

  it('keeps every eligible tab destination and new label aligned with shared-types including web constants', async () => {
    const { KIOSK_INITIAL_ROUTE_IDS, KIOSK_INITIAL_ROUTE_PATHS, KIOSK_INITIAL_ROUTE_LABELS } = await import('@raspi-system/shared-types');
    const { KIOSK_MACHINE_SIGNAL_PATH } = await import('../../machine-signal/machineSignalRoutes');
    const { KIOSK_INSPECTION_DRAWING_LIBRARY_PATH } = await import('../../part-measurement/inspection-drawing/kioskInspectionDrawingRoutes');
    expect(KIOSK_INITIAL_ROUTE_PATHS.machine_signal).toBe(KIOSK_MACHINE_SIGNAL_PATH);
    expect(KIOSK_INITIAL_ROUTE_PATHS.inspection_drawing).toBe(KIOSK_INSPECTION_DRAWING_LIBRARY_PATH);
    for (const route of KIOSK_INITIAL_ROUTE_IDS) {
      const borrow = route === 'borrow_tag' || route === 'borrow_photo';
      const tabId = borrow ? 'borrow' : route;
      const view = render(<MemoryRouter>{renderKioskReorderableHeaderTab(tabId, { ...baseContext, defaultMode: route === 'borrow_photo' ? 'PHOTO' : 'TAG', initialKioskRoute: route })}</MemoryRouter>);
      expect(screen.getByRole('link')).toHaveAttribute('href', KIOSK_INITIAL_ROUTE_PATHS[route]);
      expect(screen.getByRole('link')).toHaveAccessibleName(`開始ページ ${borrow ? '持出' : KIOSK_INITIAL_ROUTE_LABELS[route]}`);
      view.unmount();
    }
  });
});
