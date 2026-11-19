import { act, render } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useNearViewportOnce } from './useNearViewportOnce';

afterEach(() => vi.unstubAllGlobals());

function mountHook(options: { rootMargin: string; enabled?: boolean }) {
  let current!: ReturnType<typeof useNearViewportOnce<HTMLDivElement>>;
  function Probe() {
    current = useNearViewportOnce<HTMLDivElement>(options);
    return createElement('div', { ref: current.ref });
  }
  const view = render(createElement(Probe));
  return { getCurrent: () => current, ...view };
}

describe('useNearViewportOnce', () => {
  it('starts false before intersection and becomes true once intersecting', () => {
    let notify!: (isIntersecting: boolean) => void;
    let receivedOptions: IntersectionObserverInit | undefined;
    const observe = vi.fn();
    const disconnect = vi.fn();

    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        receivedOptions = options;
        notify = (isIntersecting) => {
          callback([{ isIntersecting } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
        };
      }
      observe = observe;
      disconnect = disconnect;
    });

    const { getCurrent } = mountHook({ rootMargin: '200px' });

    expect(getCurrent().isNear).toBe(false);
    expect(receivedOptions).toEqual({ rootMargin: '200px' });
    expect(observe).toHaveBeenCalledWith(getCurrent().ref.current);

    act(() => notify(false));
    expect(getCurrent().isNear).toBe(false);
    expect(disconnect).not.toHaveBeenCalled();

    act(() => notify(true));
    expect(getCurrent().isNear).toBe(true);
    expect(disconnect).toHaveBeenCalledOnce();

    act(() => notify(false));
    expect(getCurrent().isNear).toBe(true);
  });

  it('returns true immediately without observing when enabled is false', () => {
    const observe = vi.fn();
    vi.stubGlobal('IntersectionObserver', class {
      observe = observe;
      disconnect = vi.fn();
    });

    const { getCurrent } = mountHook({ rootMargin: '300px', enabled: false });

    expect(getCurrent().isNear).toBe(true);
    expect(observe).not.toHaveBeenCalled();
  });

  it('returns true immediately when IntersectionObserver is unavailable', () => {
    vi.stubGlobal('IntersectionObserver', undefined);

    const { getCurrent } = mountHook({ rootMargin: '320px 0px' });

    expect(getCurrent().isNear).toBe(true);
  });
});
