import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { WorkInstructionEditorAnnotationControls } from './WorkInstructionEditorAnnotationControls';

import type { WorkInstructionOverlayElement } from '../../api/domains/work-instructions';

const element: WorkInstructionOverlayElement = { id: 'note', kind: 'TEXT', text: '確認', pageIndex: 0, zIndex: 1, bbox: { xRatio: 0.2, yRatio: 0.2, widthRatio: 0.3, heightRatio: 0.2 } };

function renderControls() {
  const onSelect = vi.fn();
  const onNudge = vi.fn();
  const onUpdateBBox = vi.fn();
  const view = render(<WorkInstructionEditorAnnotationControls elements={[element]} selectedId="note" onSelect={onSelect} onNudge={onNudge} onUpdateBBox={onUpdateBBox} />);
  return { ...view, onSelect, onNudge, onUpdateBBox };
}

describe('WorkInstructionEditorAnnotationControls', () => {
  it('selects annotations and supports keyboard movement and resize with accessible handles', () => {
    const { onSelect, onNudge, onUpdateBBox } = renderControls();
    const note = screen.getByRole('button', { name: '文章の注釈: 確認' });
    fireEvent.click(note);
    expect(onSelect).toHaveBeenCalledWith('note');
    fireEvent.keyDown(note, { key: 'ArrowRight', shiftKey: true });
    expect(onNudge).toHaveBeenCalledWith('note', 0.01, 0);
    const handle = screen.getByRole('button', { name: '右下の大きさ変更' });
    expect(handle).toHaveClass('h-11', 'w-11');
    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    expect(onUpdateBBox).toHaveBeenCalledWith('note', { ...element.bbox, heightRatio: 0.202 });
  });

  it('does not move the annotation when opening the inspector changes the photo size', () => {
    vi.stubGlobal('PointerEvent', MouseEvent);
    try {
      const { container, onUpdateBBox } = renderControls();
      const rect = (width: number, left: number) => ({ x: left, y: 0, left, top: 0, width, height: width, right: left + width, bottom: width, toJSON: () => ({}) });
      const measured = vi.spyOn(container.firstElementChild!, 'getBoundingClientRect').mockReturnValue(rect(1000, 0));
      const note = screen.getByTestId('overlay-note');
      note.setPointerCapture = vi.fn();
      fireEvent.pointerDown(note, { clientX: 250, clientY: 250, button: 0 });
      measured.mockReturnValue(rect(700, 50));
      fireEvent.pointerMove(note, { clientX: 250, clientY: 250, button: 0 });
      expect(onUpdateBBox.mock.lastCall).toEqual(['note', element.bbox]);
    } finally { vi.unstubAllGlobals(); }
  });

  it('clamps pointer moves and restores the original box on cancellation', () => {
    vi.stubGlobal('PointerEvent', MouseEvent);
    try {
      const { container, onUpdateBBox } = renderControls();
      const surface = container.firstElementChild!;
      vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, width: 1000, height: 1000, right: 1000, bottom: 1000, toJSON: () => ({}) });
      const note = screen.getByTestId('overlay-note');
      note.setPointerCapture = vi.fn();
      note.hasPointerCapture = vi.fn().mockReturnValue(true);
      note.releasePointerCapture = vi.fn();
      fireEvent.pointerDown(note, { clientX: 200, clientY: 200, button: 0 });
      fireEvent.pointerMove(note, { clientX: 1200, clientY: 1200, button: 0 });
      expect(onUpdateBBox.mock.lastCall?.[1]).toMatchObject({ xRatio: 0.7, yRatio: 0.8 });
      fireEvent.pointerCancel(note);
      expect(onUpdateBBox.mock.lastCall).toEqual(['note', element.bbox]);
      expect(note.releasePointerCapture).toHaveBeenCalledOnce();
    } finally { vi.unstubAllGlobals(); }
  });
});
