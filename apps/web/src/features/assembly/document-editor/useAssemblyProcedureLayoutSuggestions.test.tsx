import { act, render, renderHook, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ suggest: vi.fn() }));
vi.mock('../../../api/client', () => ({ suggestAssemblyProcedureLayout: api.suggest }));

import { AssemblyProcedureOverlayLayer } from '../AssemblyProcedureOverlayLayer';

import { useAssemblyProcedureLayoutSuggestions } from './useAssemblyProcedureLayoutSuggestions';

import type { AssemblyProcedureOverlayElement } from '@raspi-system/shared-types';

const text: AssemblyProcedureOverlayElement = { id: 'text', kind: 'TEXT', pageIndex: 0, text: '架空の工程', zIndex: 1, bbox: { xRatio: 0.4, yRatio: 0.04, widthRatio: 0.5, heightRatio: 0.1 } };
const existing = [text, { ...text, id: 'other' }];
const added = { ...text, id: 'added', text: 'ワークを固定する' };
const proposal = { elements: [...existing, added], addedElementIds: ['added'], changes: ['写真を読んで 1 行足した'] };
const input = () => ({ documentId: 'document', pageIndex: 0, elements: existing, accessPassword: '1234', holderToken: 'holder', disabled: false, onStart: vi.fn(), onApply: vi.fn(), onEditLeaseError: vi.fn() });

describe('procedure layout suggestions', () => {
  beforeEach(() => { vi.resetAllMocks(); api.suggest.mockResolvedValue(proposal); });
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
});
