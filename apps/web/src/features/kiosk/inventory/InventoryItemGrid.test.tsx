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

  it('shows a two-line 17px name and the count, unit and location below', () => {
    render(<InventoryItemGrid compartments={[drawer('a', '治具', null, 4)]} onPick={vi.fn()} />);
    expect(screen.getByText('治具')).toBeInTheDocument();
    expect(screen.getByText('ケース')).toBeInTheDocument();
    expect(screen.getByText('50013_540AP 北・棚2-4')).toBeInTheDocument();
    expect(screen.getByText('治具')).toHaveClass('line-clamp-2', 'text-[17px]');
    expect(screen.getByRole('button')).toHaveTextContent('3ケース');
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
  it('shows only populated details allowed by the thumbnail size', () => {
    const compartment = drawer('a', '治具', null);
    Object.assign(compartment.item, { model: 'M1', maker: 'OSG', toolName: 'ドリル', toolSize: 'φ10', workMaterial: '鋼・SUS', usage: ' ' });
    const view = render(<InventoryItemGrid size="small" compartments={[compartment]} onPick={vi.fn()} />);
    expect(screen.getByText('型式')).toBeInTheDocument();
    expect(screen.queryByText('メーカー')).not.toBeInTheDocument();
    expect(screen.getByLabelText('登録済みアイテム')).toHaveClass('grid-cols-9');
    view.rerender(<InventoryItemGrid size="medium" compartments={[compartment]} onPick={vi.fn()} />);
    expect(screen.getByText('寸法')).toBeInTheDocument();
    expect(screen.queryByText('工具名')).not.toBeInTheDocument();
    expect(screen.getByLabelText('登録済みアイテム')).toHaveClass('grid-cols-6');
    view.rerender(<InventoryItemGrid size="large" compartments={[compartment]} onPick={vi.fn()} />);
    expect(screen.getByText('被削材')).toBeInTheDocument();
    expect(screen.queryByText('用途')).not.toBeInTheDocument();
    expect(screen.getByLabelText('登録済みアイテム')).toHaveClass('grid-cols-4');
  });

  it('cycles each card photo without opening the item and omits arrows for a single photo', () => {
    const a = drawer('a', '治具A', null), b = drawer('b', '治具B', null);
    const photo = (id: string) => ({ id, photoUrl: `/${id}.jpg`, photoIndex: 1, originalFilename: id });
    a.item.photos = [photo('a1'), photo('a2')];
    b.item.photos = [photo('b1')];
    const onPick = vi.fn();
    const { container } = render(<InventoryItemGrid compartments={[a, b]} onPick={onPick} />);
    expect(screen.getAllByRole('button', { name: '次の写真' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '次の写真' }));
    expect(screen.getByText('2/2')).toBeInTheDocument();
    expect(container.querySelector('img[src="/a2.jpg"]')).not.toBeNull();
    expect(onPick).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '次の写真' }));
    expect(screen.getByText('1/2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '前の写真' }));
    expect(screen.getByText('2/2')).toBeInTheDocument();
    expect(container.querySelector('img[src="/b1.jpg"]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /治具A/ }));
    expect(onPick).toHaveBeenCalledWith(a);
  });

  it('keeps paging independent when the same item is in two drawers', () => {
    const a = drawer('a', '治具', null);
    a.item.photos = [{ id: 'p1', photoIndex: 1, photoUrl: '/1.jpg', originalFilename: '1' }, { id: 'p2', photoIndex: 2, photoUrl: '/2.jpg', originalFilename: '2' }];
    const b = { ...a, id: 'b', drawerNumber: 2 };
    render(<InventoryItemGrid compartments={[a, b]} onPick={vi.fn()} />);
    fireEvent.click(screen.getAllByRole('button', { name: '次の写真' })[0]);
    expect(screen.getAllByText('2/2')).toHaveLength(1);
    expect(screen.getAllByText('1/2')).toHaveLength(1);
  });

});
