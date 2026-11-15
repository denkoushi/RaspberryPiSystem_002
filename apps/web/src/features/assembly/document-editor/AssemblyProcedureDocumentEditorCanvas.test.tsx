import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AssemblyProcedureDocumentEditorCanvas } from './AssemblyProcedureDocumentEditorCanvas';

import type { ComponentProps, ReactNode } from 'react';

vi.mock('../AssemblyProcedureCanvas', () => ({ AssemblyProcedureCanvas: ({ overlay }: { overlay: ReactNode }) => <div>{overlay}</div> }));
vi.mock('../AssemblyProcedureCropView', () => ({ AssemblyProcedureCropView: ({ overlay }: { overlay: ReactNode }) => <div>{overlay}</div> }));
const text = { id: 'text', kind: 'TEXT' as const, text: '手順の文章', pageIndex: 0, zIndex: 0, bbox: { xRatio: 0.1, yRatio: 0.2, widthRatio: 0.2, heightRatio: 0.2 } };
function setup(overrides: Partial<ComponentProps<typeof AssemblyProcedureDocumentEditorCanvas>> = {}) {
  const props = { pageUrl: '/page.png', pageIndex: 0, elements: [text], selectedOverlayId: text.id, editable: true, selectionMode: false, onSelectOverlay: vi.fn(), onNudgeOverlay: vi.fn(), onUpdateOverlayBBox: vi.fn(), onInteractionStart: vi.fn(), onInteractionEnd: vi.fn(), onRangeSelected: vi.fn(), onUpdateText: vi.fn(), ...overrides };
  const view = render(<AssemblyProcedureDocumentEditorCanvas {...props} />);
  return { props, view, part: screen.getByTestId('assembly-procedure-overlay-text') };
}
beforeEach(() => {
  vi.stubGlobal('PointerEvent', MouseEvent);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 1000, height: 1000 } as DOMRect);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('editor canvas interactions', () => {
  it('snaps only during a pointer interaction and leaves keyboard resizing unchanged', () => {
    const p = setup();
    fireEvent.pointerDown(p.part, { button: 0, clientX: 200, clientY: 300 });
    fireEvent.pointerUp(p.part, { clientX: 597, clientY: 300 });
    expect(p.props.onUpdateOverlayBBox).toHaveBeenLastCalledWith('text', expect.objectContaining({ xRatio: 0.5 }));
    expect(p.props.onInteractionStart).toHaveBeenCalledOnce();
    expect(p.props.onInteractionEnd).toHaveBeenCalledOnce();
    expect(screen.queryByTestId('overlay-snap-guide')).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByTestId('assembly-procedure-overlay-text-resize-se'), { key: 'ArrowRight' });
    expect(p.props.onUpdateOverlayBBox).toHaveBeenLastCalledWith('text', expect.objectContaining({ widthRatio: expect.closeTo(0.205) }));
  });
  it('starts on selected stationary release, commits on Ctrl+Enter and suppresses parent movement', async () => {
    vi.useFakeTimers();
    const p = setup();
    fireEvent.pointerDown(p.part, { button: 0, clientX: 200, clientY: 300 });
    fireEvent.pointerUp(p.part, { clientX: 200, clientY: 300 });
    expect(p.props.onInteractionEnd).toHaveBeenCalledOnce();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    act(() => vi.runOnlyPendingTimers());
    const input = screen.getByRole('textbox');
    expect(input.parentElement).toHaveStyle({ containerType: 'inline-size' });
    fireEvent.change(input, { target: { value: '直した文章' } });
    fireEvent.keyDown(input, { key: 'ArrowRight' });
    expect(p.props.onNudgeOverlay).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
    expect(p.props.onUpdateText).toHaveBeenCalledExactlyOnceWith({ ...text, text: '直した文章' });
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
  it('treats a 6px jitter as a tap, restores the position before ending history, and edits afterwards', () => {
    vi.useFakeTimers();
    const order: string[] = [];
    const p = setup({ onInteractionEnd: () => order.push('end'), onInlineEditingChange: id => { if (id) order.push('edit'); } });
    fireEvent.pointerDown(p.part, { button: 0, clientX: 200, clientY: 300 });
    fireEvent.pointerMove(p.part, { clientX: 206, clientY: 300 });
    fireEvent.pointerUp(p.part, { clientX: 206, clientY: 300 });
    expect(p.props.onUpdateOverlayBBox).toHaveBeenLastCalledWith(text.id, text.bbox);
    expect(order).toEqual(['end']);
    act(() => vi.runOnlyPendingTimers());
    expect(order).toEqual(['end', 'edit']);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });
  it('also restores a tap on an unselected part without opening the editor', () => {
    vi.useFakeTimers();
    const p = setup({ selectedOverlayId: null });
    fireEvent.pointerDown(p.part, { button: 0, clientX: 200, clientY: 300 });
    fireEvent.pointerUp(p.part, { clientX: 204, clientY: 300 });
    expect(p.props.onUpdateOverlayBBox).toHaveBeenLastCalledWith(text.id, text.bbox);
    act(() => vi.runOnlyPendingTimers());
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
  it('starts with Enter and cancels with Escape', () => {
    const p = setup();
    fireEvent.keyDown(p.part, { key: 'Enter' });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '取消する文章' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(p.props.onUpdateText).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
  it.each([{ saving: true }, { editable: false }, { locked: true }, { selectedOverlayId: null }])('does not begin inline editing when %j', flags => {
    const p = setup(flags);
    fireEvent.keyDown(p.part, { key: 'Enter' });
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
  it('renders the pending drop frame and blue source-coordinate guides in a sibling layer', () => {
    setup({ crop: { xRatio: 0.1, yRatio: 0.2, widthRatio: 0.5, heightRatio: 0.5 }, materialPreview: { bbox: text.bbox, pending: true, guides: [{ axis: 'x', coordinate: 0.2 }] } });
    const guide = screen.getByTestId('overlay-snap-guide');
    expect(guide).toHaveClass('bg-blue-500');
    expect(guide.style.left).toBe('20%');
    expect(guide.parentElement?.parentElement).toBe(screen.getByTestId('document-editor-overlay-surface'));
    expect(screen.getByTestId('material-drop-preview')).toHaveStyle({ opacity: '0.5', width: '40%' });
  });
});
