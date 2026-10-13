import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { issuedLabel } from './inventoryDailyFlow';
import { InventoryItemGrid, sortByRecentIssue } from './InventoryItemGrid';

import type { InventoryCompartment, InventoryImportSummary } from '../../../api/client';

vi.mock('../../../api/client', () => ({ inventoryThumbnailUrl: (value: string) => value }));

function drawer(id: string, name: string, lastIssuedAt: string | null, drawerNumber = 1) {
  return { id, labelNumber: drawerNumber, stockQuantity: 3, area: '50013_540AP 北', shelfNumber: 2, drawerNumber, itemTagUid: 't', lastIssuedAt, item: { id: `i-${id}`, name, unit: 'ケース', photos: [] } } as unknown as InventoryCompartment;
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
  it('shows one list row per location in recent-issue order and picks that compartment', () => {
    const a = drawer('a', '治具', null, 1);
    Object.assign(a.item, { model: ' M1 ', maker: ' OSG ', toolName: 'ドリル', toolSize: 'φ10', workMaterial: '鋼', usage: '穴あけ' });
    const b = { ...a, id: 'b', labelNumber: 42, drawerNumber: 4, stockQuantity: 0, lastIssuedAt: '2026-09-29T01:00:00Z' };
    const onPick = vi.fn();
    render(<InventoryItemGrid view="list" compartments={[a, b]} onPick={onPick} />);
    const rows = screen.getAllByRole('button');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('0042');
    expect(rows[1]).toHaveTextContent('0001');
    expect(rows[0]).toHaveTextContent('治具');
    expect(within(rows[0]).getByText('M1')).toHaveClass('truncate', 'font-bold', 'text-inv-text');
    expect(within(rows[0]).getByText('OSG')).toHaveClass('truncate', 'text-inv-muted');
    expect(rows[0]).toHaveTextContent('50013_540AP 北・棚2-4');
    expect(rows[0]).toHaveTextContent('0 ケース');
    expect(within(rows[0]).getByText('0 ケース')).toHaveClass('text-inv-amber', 'tabular-nums');
    expect(rows[1]).toHaveTextContent('3 ケース');
    expect(within(rows[1]).getByText('—')).toBeInTheDocument();
    fireEvent.click(rows[0]);
    expect(onPick).toHaveBeenCalledWith(b);
  });

  it('aligns all list headers and values, with dashes for empty fields', () => {
    const a = drawer('a', '治具', null);
    Object.assign(a.item, { model: ' M1 ', maker: ' OSG ', toolName: ' ドリル ', toolSize: ' φ10 ', workMaterial: ' 鋼 ', usage: ' 穴あけ ' });
    const view = render(<InventoryItemGrid view="list" compartments={[a]} onPick={vi.fn()} />);
    const header = screen.getByText('番号').parentElement!;
    expect(Array.from(header.children, cell => cell.textContent)).toEqual(['', '番号', '名前', '型式', 'メーカー', '工具名', '寸法', '被削材', '用途', '場所', '在庫', '持出']);
    const row = screen.getByRole('button');
    expect(Array.from(row.children, cell => cell.textContent)).toEqual(['', '0001', '治具', 'M1', 'OSG', 'ドリル', 'φ10', '鋼', '穴あけ', '50013_540AP 北・棚2-1', '3 ケース', '—']);
    expect(row).toHaveClass('min-h-16');
    expect(header.className.match(/grid-cols-\S+/)?.[0]).toBe(row.className.match(/grid-cols-\S+/)?.[0]);
    for (const cell of Array.from(row.children).slice(1)) expect(cell).toHaveClass('truncate');
    Object.assign(a.item, { model: ' ', maker: '', toolName: null, toolSize: undefined, workMaterial: '  ', usage: null });
    view.rerender(<InventoryItemGrid view="list" compartments={[a]} onPick={vi.fn()} />);
    expect(Array.from(screen.getByRole('button').children, cell => cell.textContent).slice(3, 9)).toEqual(['—', '—', '—', '—', '—', '—']);
  });

  it('shows two compact medium-card lines in order without reserving a second name line', () => {
    const a = drawer('a', '治具', null);
    Object.assign(a.item, { maker: ' OSG ', toolName: ' ドリル ', toolSize: ' φ10 ', workMaterial: ' 鋼 ', usage: ' 穴あけ ' });
    render(<InventoryItemGrid size="medium" compartments={[a]} onPick={vi.fn()} />);
    const name = screen.getByText('治具');
    expect(name).toHaveClass('line-clamp-2');
    expect(name.className).not.toMatch(/min-h-/);
    const first = screen.getByText('OSG ・ ドリル ・ φ10');
    const second = screen.getByText('鋼 ・ 穴あけ');
    expect(first).toHaveClass('truncate', 'text-inv-text');
    expect(second).toHaveClass('truncate', 'text-inv-muted');
    expect(first.nextElementSibling).toBe(second);
    expect(name.nextElementSibling).toBe(first.parentElement);
    expect(first.parentElement).toHaveClass('flex-col');
    expect(first.parentElement?.className).not.toMatch(/gap-/);
    expect(screen.queryByText('メーカー')).not.toBeInTheDocument();
  });

  it('omits blank medium-card fields and whole empty lines', () => {
    const a = drawer('a', '治具', null);
    Object.assign(a.item, { maker: ' ', toolName: 'ドリル', toolSize: null, workMaterial: '', usage: '穴あけ' });
    const view = render(<InventoryItemGrid size="medium" compartments={[a]} onPick={vi.fn()} />);
    const lines = screen.getByText('治具').nextElementSibling!;
    expect(Array.from(lines.children, line => line.textContent)).toEqual(['ドリル', '穴あけ']);
    a.item.toolName = '';
    view.rerender(<InventoryItemGrid size="medium" compartments={[a]} onPick={vi.fn()} />);
    expect(Array.from(lines.children, line => line.textContent)).toEqual(['穴あけ']);
    a.item.toolName = 'ドリル';
    a.item.usage = ' ';
    view.rerender(<InventoryItemGrid size="medium" compartments={[a]} onPick={vi.fn()} />);
    expect(Array.from(lines.children, line => line.textContent)).toEqual(['ドリル']);
    a.item.toolName = '';
    view.rerender(<InventoryItemGrid size="medium" compartments={[a]} onPick={vi.fn()} />);
    expect(lines).toBeEmptyDOMElement();
    view.rerender(<InventoryItemGrid size="small" compartments={[a]} onPick={vi.fn()} />);
    expect(screen.getByText('治具')).toHaveClass('min-h-[2.6em]');
    view.rerender(<InventoryItemGrid size="large" compartments={[a]} onPick={vi.fn()} />);
    expect(screen.getByText('治具')).toHaveClass('min-h-[2.6em]');
  });

  it('keeps unregistered candidates first in list view and picks the tapped candidate', () => {
    const pending = [
      { id: 'p5', sourceItemId: 5, area: '工具室', category: '段取工具', createdAt: '2026-09-30T05:45:05Z', photoUrl: '/pending.jpg', photoCount: 1 },
      { id: 'p4', sourceItemId: 4, area: '1号機', category: null, createdAt: '2026-09-17T05:40:04Z', photoUrl: null, photoCount: 0 },
    ] satisfies InventoryImportSummary[];
    const onPickPending = vi.fn();
    render(<InventoryItemGrid view="list" compartments={[drawer('a', '治具', null)]} onPick={vi.fn()} pending={pending} onPickPending={onPickPending} />);
    const rows = screen.getAllByRole('button');
    expect(rows.map((row) => row.getAttribute('aria-label'))).toEqual(['未登録 候補 #5 を登録する', '未登録 候補 #4 を登録する', null]);
    expect(rows[0].querySelector('img')).toHaveAttribute('src', '/pending.jpg');
    expect(within(rows[0]).getByText('段取工具')).toHaveClass('col-span-6');
    expect(Array.from(rows[0].children).slice(4).map(cell => cell.textContent)).toEqual(['工具室', '—', '—']);
    fireEvent.click(rows[1]);
    expect(onPickPending).toHaveBeenCalledWith(pending[1]);
  });

  it('uses the first photo without paging in list view and preserves card paging on return', () => {
    const a = drawer('a', '治具', null);
    Object.assign(a.item, { model: ' ', maker: 'OSG', unit: null });
    a.item.photos = [{ id: 'p1', photoIndex: 1, photoUrl: '/1.jpg', originalFilename: '1' }, { id: 'p2', photoIndex: 2, photoUrl: '/2.jpg', originalFilename: '2' }];
    const onPick = vi.fn();
    const view = render(<InventoryItemGrid compartments={[a]} onPick={onPick} />);
    fireEvent.click(screen.getByRole('button', { name: '次の写真' }));
    view.rerender(<InventoryItemGrid view="list" compartments={[a]} onPick={onPick} />);
    expect(screen.queryByRole('button', { name: '次の写真' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(view.container.querySelector('img')).toHaveAttribute('src', '/1.jpg');
    expect(screen.getByText('OSG')).toBeInTheDocument();
    expect(screen.getByText('3 個')).toBeInTheDocument();
    view.rerender(<InventoryItemGrid compartments={[a]} onPick={onPick} />);
    expect(view.container.querySelector('img')).toHaveAttribute('src', '/2.jpg');
  });

  it('shows each card its own label number, even on small cards', () => {
    const a = drawer('a', '治具', null, 1);
    render(<InventoryItemGrid size="small" compartments={[a, { ...a, id: 'b', labelNumber: 42 }]} onPick={vi.fn()} />);
    expect(screen.getByText('0001')).toHaveClass('border-dashed', 'text-inv-amber', 'font-mono', 'tabular-nums');
    expect(screen.getByText('0042')).toBeInTheDocument();
    expect(screen.getAllByLabelText('置き場所の番号')).toHaveLength(2);
  });

  it('orders drawers by the latest issue, then never-issued ones by name', () => {
    const sorted = sortByRecentIssue([
      drawer('a', 'ゲージ', null),
      drawer('b', '治具', '2026-09-29T01:00:00Z'),
      drawer('c', 'ピン', '2026-09-29T03:00:00Z'),
      drawer('d', 'カム', null),
    ]);
    expect(sorted.map((entry) => entry.id)).toEqual(['c', 'b', 'd', 'a']);
  });

  it('shows a two-line name with stock and location over the photo', () => {
    render(<InventoryItemGrid compartments={[drawer('a', '治具', null, 4)]} onPick={vi.fn()} />);
    expect(screen.getByText('治具')).toBeInTheDocument();
    expect(screen.getByText('ケース')).toBeInTheDocument();
    expect(screen.getByText('50013_540AP 北・棚2-4')).toBeInTheDocument();
    expect(screen.getByText('治具')).toHaveClass('line-clamp-2', 'text-base');
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
    expect(screen.getByText('M1')).toHaveClass('truncate');
    expect(screen.queryByText('型式')).not.toBeInTheDocument();
    expect(screen.queryByText('メーカー')).not.toBeInTheDocument();
    expect(screen.getByLabelText('登録済みアイテム')).toHaveClass('grid-cols-9');
    view.rerender(<InventoryItemGrid size="medium" compartments={[compartment]} onPick={vi.fn()} />);
    expect(screen.getByText('OSG ・ ドリル ・ φ10')).toBeInTheDocument();
    expect(screen.getByText('鋼・SUS')).toBeInTheDocument();
    expect(screen.getByText('M1')).toHaveClass('line-clamp-2', 'bg-inv-bg/75');
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
    const nav = screen.getByRole('group', { name: '写真の切り替え' });
    expect(nav.parentElement).toHaveClass('bottom-1.5', 'items-end');
    expect(nav.nextElementSibling).toHaveTextContent('0001');
    expect(nav.parentElement?.lastElementChild).toHaveAttribute('aria-label', '写真の枚数');
    for (const button of within(nav).getAllByRole('button')) expect(button).toHaveClass('w-10', 'h-[42px]');
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

  it('keeps small photo overlays minimal and highlights zero stock without an issue badge', () => {
    const entry = { ...drawer('a', '治具', '2026-10-01T00:00:00Z'), stockQuantity: 0 };
    Object.assign(entry.item, { model: 'M1', photos: [{ id: 'p1', photoUrl: '/1.jpg' }] });
    render(<InventoryItemGrid size="small" compartments={[entry]} onPick={vi.fn()} />);
    expect(screen.getByText('0')).toHaveClass('text-inv-amber');
    expect(screen.getByText('0').parentElement).toHaveClass('bg-inv-bg/75');
    expect(screen.queryByRole('button', { name: '前の写真' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('写真の枚数')).not.toBeInTheDocument();
    expect(screen.queryByText(/持出/)).not.toBeInTheDocument();
    expect(screen.getByText('M1')).toHaveClass('truncate');
    expect(screen.getByText('M1').parentElement).toContainElement(screen.getByLabelText('置き場所の番号'));
    expect(screen.getByLabelText('写真下部')).toBeEmptyDOMElement();
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
