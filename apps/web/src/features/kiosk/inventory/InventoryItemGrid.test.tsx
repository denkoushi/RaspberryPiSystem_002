import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { InventoryItemGrid, sortByRecentIssue } from './InventoryItemGrid';

import type { InventoryCompartment } from '../../../api/client';

vi.mock('../../../api/client', () => ({ inventoryThumbnailUrl: (value: string) => value }));

function drawer(id: string, name: string, lastIssuedAt: string | null, drawerNumber = 1) {
  return { id, stockQuantity: 3, area: '50013_540AP 北', shelfNumber: 2, drawerNumber, itemTagUid: 't', lastIssuedAt, item: { id: `i-${id}`, name, unit: 'ケース', photos: [] } } as unknown as InventoryCompartment;
}

describe('InventoryItemGrid', () => {
  it('orders drawers by the latest issue, then never-issued ones by name', () => {
    const sorted = sortByRecentIssue([
      drawer('a', 'ゲージ', null),
      drawer('b', '治具', '2026-09-29T01:00:00Z'),
      drawer('c', 'ピン', '2026-09-29T03:00:00Z'),
      drawer('d', 'カム', null),
    ]);
    expect(sorted.map((entry) => entry.id)).toEqual(['c', 'b', 'd', 'a']);
  });

  it('shows name, count and unit, then area, shelf and drawer on two lines', () => {
    render(<InventoryItemGrid compartments={[drawer('a', '治具', null, 4)]} onPick={vi.fn()} />);
    expect(screen.getByText('治具')).toBeInTheDocument();
    expect(screen.getByText('ケース')).toBeInTheDocument();
    expect(screen.getByText('50013_540AP 北・棚2・引出し4')).toBeInTheDocument();
  });
});
