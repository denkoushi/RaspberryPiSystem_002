import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { overlayTextFontSize } from '../../overlays/OverlayLayer';

import { InlineTextEditor, type InlineTextElement, type InlineTextFlush } from './InlineTextEditor';

const element: InlineTextElement = { id: 'text', kind: 'TEXT', text: '元の文章', pageIndex: 0, zIndex: 0, bbox: { xRatio: 0.1, yRatio: 0.2, widthRatio: 0.3, heightRatio: 0.4 }, style: { fontSizeRatio: 0.03 } };
function setup() {
  const onCommit = vi.fn(), onFinish = vi.fn();
  let flush: InlineTextFlush | null = null;
  render(<InlineTextEditor element={element} crop={{ xRatio: 0.1, yRatio: 0.1, widthRatio: 0.5, heightRatio: 0.5 }} onCommit={onCommit} onFinish={onFinish} registerFlush={value => { flush = value; }} />);
  return { onCommit, onFinish, flush: () => flush?.(), input: screen.getByRole('textbox') };
}
describe('InlineTextEditor', () => {
  it('keeps a local draft, uses the layer cqw size and allows Enter newlines and commits exactly once on blur', () => {
    const p = setup();
    expect(p.input).toHaveFocus();
    expect(overlayTextFontSize(element.style?.fontSizeRatio, { xRatio: 0.1, yRatio: 0.1, widthRatio: 0.5, heightRatio: 0.5 })).toBe('6cqw');
    expect(p.input.style.width).toBe('60%');
    fireEvent.change(p.input, { target: { value: '新しい文章' } });
    expect(p.onCommit).not.toHaveBeenCalled();
    fireEvent.keyDown(p.input, { key: 'Enter', shiftKey: true });
    expect(p.onCommit).not.toHaveBeenCalled();
    expect(fireEvent.keyDown(p.input, { key: 'Enter' })).toBe(true);
    expect(p.onCommit).not.toHaveBeenCalled();
    fireEvent.change(p.input, { target: { value: '新しい文章\n続き' } });
    fireEvent.blur(p.input);
    expect(p.onCommit).toHaveBeenCalledExactlyOnceWith({ ...element, text: '新しい文章\n続き' });
  });
  it.each(['Escape', 'empty', 'unchanged'])('does not update for %s', action => {
    const p = setup();
    if (action !== 'unchanged') fireEvent.change(p.input, { target: { value: action === 'empty' ? '  \n' : '取り消す' } });
    fireEvent.keyDown(p.input, { key: action === 'Escape' ? 'Escape' : 'Enter', ctrlKey: true });
    expect(p.onCommit).not.toHaveBeenCalled();
    expect(p.onFinish).toHaveBeenCalledOnce();
  });
  it('never confirms Enter during composition, native isComposing or keyCode 229', () => {
    const p = setup();
    fireEvent.change(p.input, { target: { value: '変換中' } });
    fireEvent.compositionStart(p.input);
    fireEvent.keyDown(p.input, { key: 'Enter', ctrlKey: true });
    fireEvent.compositionEnd(p.input);
    fireEvent.keyDown(p.input, { key: 'Enter', ctrlKey: true, isComposing: true });
    fireEvent.keyDown(p.input, { key: 'Escape', isComposing: true });
    fireEvent.keyDown(p.input, { key: 'Enter', ctrlKey: true, keyCode: 229 });
    fireEvent.keyDown(p.input, { key: 'Escape', keyCode: 229 });
    expect(p.onCommit).not.toHaveBeenCalled();
    fireEvent.keyDown(p.input, { key: 'Enter', ctrlKey: true });
    expect(p.onCommit).toHaveBeenCalledOnce();
  });
  it.each(['ctrlKey', 'metaKey'])('confirms with %s+Enter', modifier => {
    const p = setup();
    fireEvent.change(p.input, { target: { value: '確定' } });
    fireEvent.keyDown(p.input, { key: 'Enter', [modifier]: true });
    expect(p.onCommit).toHaveBeenCalledExactlyOnceWith({ ...element, text: '確定' });
  });
  it.each(['blur', 'outside', 'flush'])('commits once through %s', action => {
    const p = setup();
    fireEvent.change(p.input, { target: { value: '確定する文章' } });
    if (action === 'blur') fireEvent.blur(p.input);
    if (action === 'outside') fireEvent.pointerDown(document.body);
    if (action === 'flush') act(() => { expect(p.flush()?.text).toBe('確定する文章'); });
    act(() => { p.flush(); });
    expect(p.onCommit).toHaveBeenCalledExactlyOnceWith({ ...element, text: '確定する文章' });
  });
  it('stops arrow and pointer events reaching the parent move handlers', () => {
    const key = vi.fn(), pointer = vi.fn();
    render(<div onKeyDown={key} onPointerDown={pointer}><InlineTextEditor element={element} onCommit={vi.fn()} onFinish={vi.fn()} /></div>);
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'ArrowRight' });
    fireEvent.pointerDown(screen.getByRole('textbox'));
    expect(key).not.toHaveBeenCalled(); expect(pointer).not.toHaveBeenCalled();
  });
});
