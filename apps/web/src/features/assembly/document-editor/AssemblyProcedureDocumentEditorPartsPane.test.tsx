import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createOverlayForRange } from './assemblyDocumentEditorDraft';
import { AssemblyProcedureDocumentEditorPartsPane } from './AssemblyProcedureDocumentEditorPartsPane';

import type { ComponentProps } from 'react';

const overlayMock = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock('../AssemblyProcedureOverlayLayer', async importOriginal => ({
  ...await importOriginal<typeof import('../AssemblyProcedureOverlayLayer')>(),
  AssemblyProcedureOverlayLayer: (props: unknown) => { overlayMock.render(props); return <span data-testid="part-preview" />; }
}));
const bbox = { xRatio: 0.1, yRatio: 0.2, widthRatio: 0.2, heightRatio: 0.3 };
const elements = [
  { ...createOverlayForRange('TEXT', 0, bbox), id: 'back', zIndex: 1 },
  { ...createOverlayForRange('SHAPE', 0, bbox), id: 'tie-first', zIndex: 4 },
  { ...createOverlayForRange('SHAPE', 0, bbox), id: 'tie-last', zIndex: 4 },
  { ...createOverlayForRange('SHAPE', 0, bbox), id: 'front', zIndex: 10 }
];
function props(overrides: Partial<ComponentProps<typeof AssemblyProcedureDocumentEditorPartsPane>> = {}) {
  return { elements, pageIndex: 0, onDuplicate: vi.fn(), selectedOverlayId: 'tie-last', hiddenOverlayIds: new Set<string>(), onSelect: vi.fn(), onBringForward: vi.fn(), onSendBackward: vi.fn(), onToggleHidden: vi.fn(), readOnly: false, busy: false, ...overrides };
}

describe('AssemblyProcedureDocumentEditorPartsPane', () => {
  it('lists the front first, including array order ties, and selects the pressed part', () => {
    const p = props();
    render(<AssemblyProcedureDocumentEditorPartsPane {...p} />);
    const options = screen.getAllByRole('option');
    expect(options.map(row => row.getAttribute('aria-label'))).toEqual([
      '1: 図形オーバーレイ: RECTANGLE', '2: 図形オーバーレイ: RECTANGLE',
      '3: 図形オーバーレイ: RECTANGLE', '4: 文章オーバーレイ: ここに文章を入力'
    ]);
    expect(options.map(row => row.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false', 'false']);
    fireEvent.click(options[2]);
    expect(p.onSelect).toHaveBeenCalledExactlyOnceWith('tie-first');
    expect(screen.queryByText('図形オーバーレイ: RECTANGLE')).not.toBeInTheDocument();
  });

  it('switches counts and groups other pages in page order and front order, then copies a card', () => {
    const other = [
      { ...elements[0], id: 'p3', pageIndex: 2 },
      { ...elements[1], id: 'p2-back', pageIndex: 1 },
      { ...elements[2], id: 'p2-front', pageIndex: 1 }
    ];
    const p = props({ elements: [...other, ...elements] });
    render(<AssemblyProcedureDocumentEditorPartsPane {...p} />);
    expect(screen.getByRole('complementary', { name: '部品' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'このページ 4' })).toHaveAttribute('aria-pressed', 'true');
    const otherButton = screen.getByRole('button', { name: 'ほか 3' });
    fireEvent.click(otherButton);
    expect(otherButton).toHaveAttribute('aria-pressed', 'true');
    const list = screen.getByRole('listbox', { name: 'ほかのページの部品' });
    expect(list).toHaveClass('min-h-0', 'overflow-y-auto');
    expect(screen.getAllByRole('heading', { level: 3 }).map(row => row.textContent)).toEqual(['p2', 'p3']);
    expect(screen.getAllByRole('option').map(row => row.getAttribute('aria-label'))).toEqual([
      'p2から置く: 図形オーバーレイ: RECTANGLE', 'p2から置く: 図形オーバーレイ: RECTANGLE',
      'p3から置く: 文章オーバーレイ: ここに文章を入力'
    ]);
    for (const label of ['前へ出す', '後ろへ下げる', '隠す']) expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('option')[0]);
    expect(p.onDuplicate).toHaveBeenCalledExactlyOnceWith('p2-front');
    expect(p.onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole('listbox', { name: 'このページの部品' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'このページ 4' })).toHaveAttribute('aria-pressed', 'true');
  });

  it.each([{ readOnly: true }, { busy: true }])('shows other pages but prevents copying when %j', overrides => {
    const p = props({ ...overrides, elements: [{ ...elements[0], pageIndex: 1 }] });
    render(<AssemblyProcedureDocumentEditorPartsPane {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'ほか 1' }));
    const card = screen.getByRole('option');
    expect(card).toBeDisabled();
    fireEvent.click(card);
    expect(p.onDuplicate).not.toHaveBeenCalled();
    expect(screen.getByRole('listbox', { name: 'ほかのページの部品' })).toBeInTheDocument();
  });

  it('keeps the source toggle while updating rows and counts for a new current page', () => {
    const p = props({ elements: [elements[0], { ...elements[1], id: 'other', pageIndex: 1 }] });
    const view = render(<AssemblyProcedureDocumentEditorPartsPane {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'ほか 1' }));
    expect(screen.getByRole('heading', { name: 'p2' })).toBeInTheDocument();
    view.rerender(<AssemblyProcedureDocumentEditorPartsPane {...p} pageIndex={1} />);
    expect(screen.getByRole('button', { name: 'ほか 1' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('heading', { name: 'p1' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'p2' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('option'));
    expect(p.onDuplicate).toHaveBeenCalledExactlyOnceWith('back');
  });

  it('connects reorder and hide controls and dims hidden parts', () => {
    const p = props();
    const view = render(<AssemblyProcedureDocumentEditorPartsPane {...p} />);
    fireEvent.click(screen.getByRole('button', { name: '前へ出す' }));
    fireEvent.click(screen.getByRole('button', { name: '後ろへ下げる' }));
    fireEvent.click(screen.getByRole('button', { name: '隠す' }));
    expect(p.onBringForward).toHaveBeenCalledExactlyOnceWith('tie-last');
    expect(p.onSendBackward).toHaveBeenCalledExactlyOnceWith('tie-last');
    expect(p.onToggleHidden).toHaveBeenCalledExactlyOnceWith('tie-last');
    view.rerender(<AssemblyProcedureDocumentEditorPartsPane {...p} hiddenOverlayIds={new Set(['tie-last'])} />);
    expect(screen.getAllByRole('option')[1]).toHaveClass('opacity-40');
    fireEvent.click(screen.getByRole('button', { name: '出す' }));
    expect(p.onToggleHidden).toHaveBeenCalledTimes(2);
  });

  it('disables reorder controls at each end', () => {
    const p = props({ selectedOverlayId: 'front' });
    const view = render(<AssemblyProcedureDocumentEditorPartsPane {...p} />);
    expect(screen.getByRole('button', { name: '前へ出す' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '後ろへ下げる' })).toBeEnabled();
    view.rerender(<AssemblyProcedureDocumentEditorPartsPane {...p} selectedOverlayId="back" />);
    expect(screen.getByRole('button', { name: '前へ出す' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '後ろへ下げる' })).toBeDisabled();
  });

  it.each([{ selectedOverlayId: null }, { readOnly: true }, { busy: true }])('disables the footer when %j', overrides => {
    render(<AssemblyProcedureDocumentEditorPartsPane {...props(overrides)} />);
    for (const label of ['前へ出す', '後ろへ下げる', '隠す']) expect(screen.getByRole('button', { name: label })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^ほか/ })).toBeEnabled();
  });

  it('scrolls the selected row into view when canvas selection changes', () => {
    const p = props({ selectedOverlayId: null });
    const view = render(<AssemblyProcedureDocumentEditorPartsPane {...p} />);
    const selected = screen.getAllByRole('option')[1];
    const scroll = vi.fn();
    selected.scrollIntoView = scroll;
    view.rerender(<AssemblyProcedureDocumentEditorPartsPane {...p} selectedOverlayId="tie-last" />);
    expect(scroll).toHaveBeenCalledExactlyOnceWith({ block: 'nearest' });
  });

  it('renders one display-only overlay per row with assets and a padded crop clamped to the page', () => {
    overlayMock.render.mockClear();
    const edge = { ...elements[0], bbox: { xRatio: 0, yRatio: 0.9, widthRatio: 1, heightRatio: 0.1 } };
    const assets = {};
    render(<AssemblyProcedureDocumentEditorPartsPane {...props({ elements: [edge], assets })} />);
    const passed = overlayMock.render.mock.calls[0][0];
    expect(passed).toMatchObject({ elements: [edge], assets, crop: { xRatio: 0, yRatio: 0.894, widthRatio: 1 } });
    expect(passed.crop.heightRatio).toBeCloseTo(0.106);
    expect(passed).not.toHaveProperty('interactive');
    const box = screen.getByTestId('part-preview').parentElement!;
    expect(box.style.aspectRatio).toBe(`1 / ${passed.crop.heightRatio * 1.414}`);
    const paddedBox = box.parentElement!;
    expect(Number.parseFloat(paddedBox.style.width)).toBeLessThanOrEqual(224);
    expect(Number.parseFloat(paddedBox.style.height)).toBeGreaterThanOrEqual(24);
  });
});
