import { useEffect, useRef, useState } from 'react';

import type { RefObject } from 'react';

export function useNearViewportOnce<T extends Element>({
  rootMargin,
  enabled = true
}: {
  rootMargin: string;
  enabled?: boolean;
}): { ref: RefObject<T | null>; isNear: boolean } {
  const ref = useRef<T>(null);
  const [hasIntersected, setHasIntersected] = useState(false);
  const isNear = !enabled || hasIntersected || typeof IntersectionObserver === 'undefined';

  useEffect(() => {
    if (isNear) return;
    const target = ref.current;
    if (!target) return;

    let disconnected = false;
    const disconnect = () => {
      if (disconnected) return;
      disconnected = true;
      observer.disconnect();
    };
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        disconnect();
        setHasIntersected(true);
      },
      { rootMargin }
    );
    observer.observe(target);
    return disconnect;
  }, [isNear, rootMargin]);

  return { ref, isNear };
}
