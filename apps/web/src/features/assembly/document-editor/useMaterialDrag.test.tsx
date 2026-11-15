import { act, fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { materialPreviewSize, useMaterialDrag } from './useMaterialDrag';

import type { ProcedureMaterialDto } from '../procedure-manuals/procedure-material-types';

const material = { id: 'text', kind: 'TEXT', text: '手順' } as ProcedureMaterialDto;
function setup(enabled = true, place = vi.fn(async () => {})) {
  const error = vi.fn();
  function Test() {
    const ref = useRef<HTMLDivElement>(null);
    const drag = useMaterialDrag({ layerRef: ref, enabled, pageIndex: 0, elements: [], place, onError: error });
    return <><span data-testid="shadow">{drag.shadow ? JSON.stringify(drag.shadow) : ''}</span><button onPointerDown={event => drag.onPointerDown(material, event)} onClick={() => drag.onClick(material)}>素材</button><div ref={ref} data-testid="surface" /><output>{drag.preview ? JSON.stringify(drag.preview) : ''}</output></>;
  }
  render(<Test />);
  const surface = screen.getByTestId('surface');
  vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue({ left: 100, top: 50, width: 1000, height: 500 } as DOMRect);
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => surface) });
  return { place, error, surface, card: screen.getByRole('button') };
}
beforeEach(() => {
  class TestPointerEvent extends MouseEvent {
    pointerId: number;
    pointerType: string;
    constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 1; this.pointerType = init.pointerType ?? 'mouse'; }
  }
  vi.stubGlobal('PointerEvent', TestPointerEvent);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('material dragging', () => {
  it('lifts at 6px, uses the overlay rect and retains the pending drop frame', async () => {
    let resolve!: () => void;
    const place = vi.fn(() => new Promise<void>(done => { resolve = done; }));
    const p = setup(true, place);
    fireEvent.pointerDown(p.card, { pointerId: 1, button: 0, clientX: 0, clientY: 0, pointerType: 'mouse' });
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 5, clientY: 0 });
    expect(screen.getByRole('status').textContent).toBe('');
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 600, clientY: 300 });
    expect(JSON.parse(screen.getByRole('status').textContent!).bbox.xRatio).toBeCloseTo(0.1);
    fireEvent.pointerUp(document, { pointerId: 1, clientX: 600, clientY: 300 });
    expect(place).toHaveBeenCalledExactlyOnceWith(material, { bbox: { xRatio: expect.closeTo(0.1), yRatio: 0.4, widthRatio: 0.8, heightRatio: 0.2 } });
    expect(screen.getByRole('status')).toHaveTextContent('"pending":true');
    fireEvent.click(p.card);
    expect(place).toHaveBeenCalledOnce();
    await act(async () => resolve());
    expect(screen.getByRole('status').textContent).toBe('');
  });
  it('requires a 250ms touch hold and cancels early movement, Escape and off-page drops', () => {
    vi.useFakeTimers();
    const p = setup();
    const down = () => fireEvent.pointerDown(p.card, { pointerId: 1, button: 0, clientX: 0, clientY: 0, pointerType: 'touch' });
    down();
    act(() => vi.advanceTimersByTime(249));
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 1, clientY: 0 });
    expect(fireEvent.touchMove(p.card, { cancelable: true })).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    fireEvent.pointerUp(document, { pointerId: 1, clientX: 600, clientY: 300 });
    expect(p.place).not.toHaveBeenCalled();
    down(); act(() => vi.advanceTimersByTime(250));
    expect(screen.getByTestId('shadow')).toHaveTextContent('text');
    expect(fireEvent.touchMove(p.card, { cancelable: true })).toBe(false);
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 600, clientY: 300 });
    expect(screen.getByRole('status').textContent).not.toBe('');
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.pointerUp(document, { pointerId: 1, clientX: 600, clientY: 300 });
    expect(screen.getByRole('status').textContent).toBe('');
    expect(screen.getByTestId('shadow').textContent).toBe('');
    down(); act(() => vi.advanceTimersByTime(250));
    vi.mocked(document.elementFromPoint).mockReturnValue(null);
    fireEvent.pointerUp(document, { pointerId: 1, clientX: 600, clientY: 300 });
    expect(p.place).not.toHaveBeenCalled();
  });
  it('supports keyboard click placement and reports API failure', async () => {
    const p = setup(true, vi.fn(async () => { throw new Error('failure'); }));
    fireEvent.click(p.card);
    await act(async () => {});
    expect(p.place).toHaveBeenCalledExactlyOnceWith(material);
    expect(p.error).toHaveBeenCalledOnce();
  });
  it('does not begin or place without editing permission', () => {
    const p = setup(false);
    fireEvent.pointerDown(p.card, { pointerId: 1, button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerUp(document, { pointerId: 1, clientX: 600, clientY: 300 });
    fireEvent.click(p.card);
    expect(p.place).not.toHaveBeenCalled();
  });
  it('matches server photo aspect ratio and maximum height', () => {
    expect(materialPreviewSize({ kind: 'PHOTO', width: 400, height: 200 }, 2)).toEqual({ widthRatio: 0.4, heightRatio: 0.4 });
    const tall = materialPreviewSize({ kind: 'PHOTO', width: 100, height: 1000 }, 1);
    expect(tall.heightRatio).toBe(0.9);
    expect(tall.widthRatio).toBeCloseTo(0.09);
  });
});
