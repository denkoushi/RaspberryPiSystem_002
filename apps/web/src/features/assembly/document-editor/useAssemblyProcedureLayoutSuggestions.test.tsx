import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ suggest: vi.fn() }));
vi.mock('../../../api/client', () => ({ suggestAssemblyProcedureLayout: api.suggest }));

import { AssemblyProcedureOverlayLayer } from '../AssemblyProcedureOverlayLayer';

import { AssemblyProcedureLayoutSuggestionPanel } from './AssemblyProcedureLayoutSuggestionPanel';
import { useAssemblyProcedureLayoutSuggestions } from './useAssemblyProcedureLayoutSuggestions';

import type { AssemblyProcedureOverlayElement } from '@raspi-system/shared-types';

const text: AssemblyProcedureOverlayElement = { id: 'text', kind: 'TEXT', pageIndex: 0, text: '架空の工程', zIndex: 1, bbox: { xRatio: 0.4, yRatio: 0.04, widthRatio: 0.5, heightRatio: 0.1 } };
const existing = [text, { ...text, id: 'other' }];
const added = { ...text, id: 'added', text: 'ワークを固定する' };
const proposal = { elements: [...existing, added], addedElementIds: ['added'], changes: ['写真を読んで 1 行足した'] };
const input = () => ({ documentId: 'document', pageIndex: 0, elements: existing, accessPassword: '1234', holderToken: 'holder', disabled: false, onStart: vi.fn(), onApply: vi.fn(), onEditLeaseError: vi.fn() });
const overflow = {
  shrink: { elements: [{ ...text, bbox: { ...text.bbox, yRatio: 0.2 } }, existing[1], added], changes: ['写真を縮めた'], scalePercent: 88 },
  split: { elements: [text], nextPageElements: [existing[1], added].map(element => ({ ...element, pageIndex: 1 })), changes: ['2ページに分けた'], firstMovedPhotoNumber: 3 }
};

describe('procedure layout suggestions', () => {
  beforeEach(() => { vi.resetAllMocks(); api.suggest.mockResolvedValue(proposal); });
  it('shows both accessible choices, changes preview with selection and applies shrink', async () => {
    api.suggest.mockResolvedValue({ ...proposal, elements: existing, overflow });
    const props = input();
    function Panel() {
      const suggestions = useAssemblyProcedureLayoutSuggestions(props);
      return <><button onClick={() => void suggestions.start()}>整える</button>
        <AssemblyProcedureLayoutSuggestionPanel suggestions={suggestions} />
        <output data-testid="preview">{JSON.stringify(suggestions.previewElements)}</output></>;
    }
    render(<Panel />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '整える' })); });
    expect(screen.getByText('写真が1ページに入りきりません')).toBeInTheDocument();
    const shrink = screen.getByRole('button', { name: /写真を縮める/ });
    const split = screen.getByRole('button', { name: /2ページに分ける/ });
    expect(shrink).toHaveAttribute('aria-pressed', 'true');
    expect(shrink).toHaveTextContent('写真 88%');
    expect(split).toHaveTextContent('3枚目から次へ');
    expect(screen.getByTestId('preview')).toHaveTextContent('"yRatio":0.2');
    fireEvent.click(split);
    expect(split).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('preview').textContent).toBe(JSON.stringify([text]));
    fireEvent.click(screen.getByRole('button', { name: '前' }));
    expect(screen.getByTestId('preview').textContent).toBe('null');
    fireEvent.click(shrink);
    fireEvent.click(screen.getByRole('button', { name: 'これにする' }));
    expect(props.onApply).toHaveBeenCalledWith(overflow.shrink.elements);
  });
  it.each(['shrink', 'split'] as const)('offers only the feasible %s option', async selected => {
    api.suggest.mockResolvedValue({ ...proposal, elements: existing, overflow: { [selected]: overflow[selected] } });
    const props = input(); const hook = renderHook(() => useAssemblyProcedureLayoutSuggestions(props));
    await act(async () => hook.result.current.start());
    render(<AssemblyProcedureLayoutSuggestionPanel suggestions={hook.result.current} />);
    expect(screen.getByRole('button', { name: selected === 'shrink' ? /写真を縮める/ : /2ページに分ける/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: selected === 'split' ? /写真を縮める/ : /2ページに分ける/ })).not.toBeInTheDocument();
  });
  it('locks an in-flight split, applies only once and retains caption ids only on success', async () => {
    api.suggest.mockResolvedValue({ ...proposal, elements: existing, overflow });
    let finish!: (success: boolean) => void;
    const onApplySplit = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
    const props = { ...input(), onApplySplit };
    const hook = renderHook(() => useAssemblyProcedureLayoutSuggestions(props));
    await act(async () => hook.result.current.start());
    act(() => hook.result.current.selectOption('split'));
    let pending: Promise<void> | undefined;
    act(() => { pending = hook.result.current.apply(); });
    act(() => { hook.result.current.apply(); hook.result.current.cancel(); hook.result.current.selectOption('shrink'); });
    expect(onApplySplit).toHaveBeenCalledExactlyOnceWith(overflow.split.elements, overflow.split.nextPageElements);
    expect(hook.result.current.state).toMatchObject({ status: 'preview', selectedOption: 'split', applying: true });
    await act(async () => { finish(true); await pending; });
    expect(hook.result.current.appliedCaptionElementIds).toEqual(['added']);
    expect(hook.result.current.state.status).toBe('idle');
    expect(props.onApply).not.toHaveBeenCalled();
  });
  it('colors only added TEXT in the after preview and applies ordinary new text', async () => {
    const props = input(); const hook = renderHook(() => useAssemblyProcedureLayoutSuggestions(props));
    await act(async () => hook.result.current.start());
    const elements = hook.result.current.previewElements!;
    const view = render(<AssemblyProcedureOverlayLayer elements={elements} />);
    expect(screen.getByTestId('assembly-procedure-overlay-added')).toHaveStyle({ backgroundColor: '#fff2c6' });
    expect(screen.getByTestId('assembly-procedure-overlay-text').style.backgroundColor).toBe('');
    expect(proposal.elements[2]).not.toHaveProperty('mask');
    act(() => hook.result.current.showBefore(true));
    expect(hook.result.current.previewElements).toBeNull();
    act(() => hook.result.current.showBefore(false));
    expect(hook.result.current.previewElements![2]).toMatchObject({ mask: { enabled: true } });
    act(() => hook.result.current.apply());
    expect(props.onApply).toHaveBeenCalledWith(proposal.elements);
    view.rerender(<AssemblyProcedureOverlayLayer elements={props.onApply.mock.calls[0][0]} />);
    expect(screen.getByTestId('assembly-procedure-overlay-added').style.backgroundColor).toBe('');
    expect(hook.result.current.state.status).toBe('idle');
  });
  it('ignores a late result after cancellation', async () => {
    let finish!: (value: typeof proposal) => void;
    api.suggest.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const props = input(); const hook = renderHook(() => useAssemblyProcedureLayoutSuggestions(props));
    let pending!: Promise<void>;
    act(() => { pending = hook.result.current.start(); });
    act(() => hook.result.current.cancel());
    await act(async () => { finish(proposal); await pending; });
    expect(hook.result.current.state.status).toBe('idle'); expect(props.onApply).not.toHaveBeenCalled();
  });
  it('accumulates applied ids across pages and proposals, retains them on cancel, and resets for another document', async () => {
    const props = input();
    const hook = renderHook(next => useAssemblyProcedureLayoutSuggestions(next), { initialProps: props });
    await act(async () => hook.result.current.start());
    expect(hook.result.current.appliedCaptionElementIds).toEqual([]);
    act(() => hook.result.current.cancel());
    expect(hook.result.current.appliedCaptionElementIds).toEqual([]);
    await act(async () => hook.result.current.start());
    act(() => hook.result.current.apply());
    hook.rerender({ ...props, pageIndex: 1 });
    expect(hook.result.current.appliedCaptionElementIds).toEqual(['added']);
    api.suggest.mockResolvedValue({ ...proposal, addedElementIds: ['added', 'second'] });
    await act(async () => hook.result.current.start());
    act(() => hook.result.current.apply());
    expect(hook.result.current.appliedCaptionElementIds).toEqual(['added', 'second']);
    act(() => hook.result.current.cancel());
    expect(hook.result.current.appliedCaptionElementIds).toEqual(['added', 'second']);
    hook.rerender({ ...props, documentId: 'another-document' });
    expect(hook.result.current.appliedCaptionElementIds).toEqual([]);
  });

});
