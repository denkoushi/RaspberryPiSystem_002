import { cleanup, render, screen } from '@testing-library/react';
import { Component, Suspense, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ADMIN_CHUNK_RELOAD_WINDOW_MS, adminLazy, type AdminChunkReloadRuntime } from './adminLazy';

class Boundary extends Component<{ children: ReactNode }, { error?: unknown }> {
  state: { error?: unknown } = {};
  static getDerivedStateFromError(error: unknown) { return { error }; }
  render() { return this.state.error ? <p>failed</p> : this.props.children; }
}

function runtime(stored: string | null, nowMs = 1_000_000): AdminChunkReloadRuntime & { stored: string | null } {
  const state = {
    stored,
    now: () => nowMs,
    readStored: () => state.stored,
    writeStored: vi.fn((value: string) => { state.stored = value; }),
    reload: vi.fn()
  };
  return state;
}

const chunkError = () => new TypeError('Failed to fetch dynamically imported module: /assets/x.js');
const mount = (node: ReactNode) => render(<Boundary><Suspense fallback={<p>loading</p>}>{node}</Suspense></Boundary>);

afterEach(cleanup);

describe('adminLazy', () => {
  it('renders the loaded component', async () => {
    const Page = adminLazy(() => Promise.resolve({ default: () => <p>page</p> }), runtime(null));
    mount(<Page />);
    expect(await screen.findByText('page')).toBeInTheDocument();
  });

  it('reloads once when a chunk is missing after a deployment', async () => {
    const rt = runtime(null);
    const Page = adminLazy(() => Promise.reject(chunkError()), rt);
    mount(<Page />);
    await vi.waitFor(() => expect(rt.reload).toHaveBeenCalledTimes(1));
    expect(rt.stored).toBe('1000000');
    expect(screen.getByText('loading')).toBeInTheDocument();
  });

  it('surfaces the error instead of looping when a reload just happened', async () => {
    const rt = runtime(String(1_000_000 - ADMIN_CHUNK_RELOAD_WINDOW_MS + 1));
    const Page = adminLazy(() => Promise.reject(chunkError()), rt);
    mount(<Page />);
    expect(await screen.findByText('failed')).toBeInTheDocument();
    expect(rt.reload).not.toHaveBeenCalled();
  });

  it('reloads again once the window has passed', async () => {
    const rt = runtime(String(1_000_000 - ADMIN_CHUNK_RELOAD_WINDOW_MS));
    const Page = adminLazy(() => Promise.reject(chunkError()), rt);
    mount(<Page />);
    await vi.waitFor(() => expect(rt.reload).toHaveBeenCalledTimes(1));
  });

  it('does not reload for ordinary module errors', async () => {
    const rt = runtime(null);
    const Page = adminLazy(() => Promise.reject(new Error('boom')), rt);
    mount(<Page />);
    expect(await screen.findByText('failed')).toBeInTheDocument();
    expect(rt.reload).not.toHaveBeenCalled();
  });

  it('does not reload when session storage is unavailable', async () => {
    const rt = runtime(null);
    rt.readStored = () => { throw new Error('denied'); };
    const Page = adminLazy(() => Promise.reject(chunkError()), rt);
    mount(<Page />);
    expect(await screen.findByText('failed')).toBeInTheDocument();
    expect(rt.reload).not.toHaveBeenCalled();
  });
});
