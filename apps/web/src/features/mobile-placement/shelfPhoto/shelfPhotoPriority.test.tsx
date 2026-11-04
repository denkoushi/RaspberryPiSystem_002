import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getMobilePlacementShelfPhoto } from '../../../api/client';

import { ShelfPhoto } from './ShelfPhoto';

vi.mock('../../../api/client', () => ({ getMobilePlacementShelfPhoto: vi.fn() }));

const shelves = ['A', 'B', 'C', 'D', 'E', 'F'].map((code) => ({ shelfCodeRaw: code, displayLabel: code, photoUpdatedAt: 'v1' }));

function renderGrid() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}>{shelves.map((s) => <ShelfPhoto key={s.shelfCodeRaw} shelf={s} />)}</QueryClientProvider>);
  return client;
}

let create: ReturnType<typeof vi.fn>;
beforeEach(() => {
  create = vi.fn((blob: Blob) => `blob:${(blob as Blob & { code: string }).code}`);
  vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: vi.fn() });
  vi.mocked(getMobilePlacementShelfPhoto).mockImplementation(async (code: string) => Object.assign(new Blob([code]), { code }));
});
afterEach(() => { vi.mocked(getMobilePlacementShelfPhoto).mockReset(); vi.unstubAllGlobals(); });

describe('ShelfPhoto loading priority', () => {
  it('fetches every photo at mount when IntersectionObserver is unavailable', async () => {
    renderGrid();
    await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(6));
    expect(getMobilePlacementShelfPhoto).toHaveBeenCalledTimes(6);
  });

  it('fetches tiles near the viewport first and the rest at idle, four at a time, keeping the placeholder until near', async () => {
    const targets: Element[] = [];
    let notify: (records: { target: Element; isIntersecting: boolean }[]) => void = () => {};
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: typeof notify) { notify = callback; }
      observe(el: Element) { targets.push(el); }
      unobserve() {}
      disconnect() {}
    });
    const idle: (() => void)[] = [];
    vi.stubGlobal('requestIdleCallback', (run: () => void) => { idle.push(run); return idle.length; });

    renderGrid();
    expect(screen.getAllByLabelText(/写真なし/)).toHaveLength(6);
    expect(getMobilePlacementShelfPhoto).not.toHaveBeenCalled();

    const near = screen.getByLabelText('B 写真なし');
    act(() => notify([{ target: near, isIntersecting: true }]));
    await waitFor(() => expect(screen.getByAltText('B の写真').getAttribute('src')).toBe('blob:B'));
    expect(getMobilePlacementShelfPhoto).toHaveBeenCalledTimes(1);

    await act(async () => { idle.shift()?.(); });
    expect(vi.mocked(getMobilePlacementShelfPhoto).mock.calls.map(([code]) => code)).toEqual(['B', 'A', 'C', 'D', 'E']);
    await waitFor(() => expect(idle.length).toBeGreaterThan(0));
    await act(async () => { idle.shift()?.(); });
    await waitFor(() => expect(getMobilePlacementShelfPhoto).toHaveBeenCalledTimes(6));
    expect(screen.getAllByLabelText(/写真なし/)).toHaveLength(5);
    expect(create).toHaveBeenCalledTimes(1);

    act(() => notify([{ target: screen.getByLabelText('F 写真なし'), isIntersecting: true }]));
    await waitFor(() => expect(screen.getByAltText('F の写真').getAttribute('src')).toBe('blob:F'));
    expect(getMobilePlacementShelfPhoto).toHaveBeenCalledTimes(6);
    expect(targets).toHaveLength(6);
  });
});
