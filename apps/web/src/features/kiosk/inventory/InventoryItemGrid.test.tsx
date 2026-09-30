import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { issuedLabel } from './inventoryDailyFlow';
import { InventoryItemGrid, sortByRecentIssue } from './InventoryItemGrid';

import type { InventoryCompartment, InventoryImportSummary } from '../../../api/client';

vi.mock('../../../api/client', () => ({ inventoryThumbnailUrl: (value: string) => value }));

function drawer(id: string, name: string, lastIssuedAt: string | null, drawerNumber = 1) {
  return { id, stockQuantity: 3, area: '50013_540AP 北', shelfNumber: 2, drawerNumber, itemTagUid: 't', lastIssuedAt, item: { id: `i-${id}`, name, unit: 'ケース', photos: [] } } as unknown as InventoryCompartment;
}

describe('issuedLabel', () => {
  it('uses short relative words, then the date', () => {
    const now = new Date('2026-09-30T03:00:00Z');
    expect(issuedLabel('2026-09-30T02:58:00Z', now)).toBe('2分前');
    expect(issuedLabel('2026-09-30T00:00:00Z', now)).toBe('3時間前');
    expect(issuedLabel('2026-09-29T05:00:00Z', now)).toBe('昨日');
    expect(issuedLabel('2026-09-27T05:00:00Z', now)).toBe('9/27');
    expect(issuedLabel(null, now)).toBeNull();
  });
});

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
    expect(screen.getByText('50013_540AP 北')).toBeInTheDocument();
    expect(screen.getByText('棚2 引4')).toBeInTheDocument();
  });

  it('leads with unregistered candidates, newest first, and opens setup for the tapped one', () => {
    const pending = [
      { id: 'p5', sourceItemId: 5, area: '30042S_FJV50/80', category: '段取工具', createdAt: '2026-09-30T05:45:05Z', photoUrl: null, photoCount: 1 },
      { id: 'p4', sourceItemId: 4, area: '50013_540AP', category: null, createdAt: '2026-09-17T05:40:04Z', photoUrl: null, photoCount: 1 },
    ] satisfies InventoryImportSummary[];
    const onPickPending = vi.fn();
    render(<InventoryItemGrid compartments={[drawer('a', '治具', null)]} onPick={vi.fn()} pending={pending} onPickPending={onPickPending} />);

    const cards = screen.getAllByRole('button');
    expect(cards.map((card) => card.getAttribute('aria-label'))).toEqual(['未登録 候補 #5 を登録する', '未登録 候補 #4 を登録する', null]);
    fireEvent.click(cards[0]);
    expect(onPickPending).toHaveBeenCalledWith(pending[0]);
  });
});
