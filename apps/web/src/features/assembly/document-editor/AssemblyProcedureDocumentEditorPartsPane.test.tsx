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
  return { elements, selectedOverlayId: 'tie-last', hiddenOverlayIds: new Set<string>(), onSelect: vi.fn(), onBringForward: vi.fn(), onSendBackward: vi.fn(), onToggleHidden: vi.fn(), readOnly: false, busy: false, ...overrides };
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
    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled();
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
