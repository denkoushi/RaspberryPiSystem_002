import { useLayoutEffect, useState } from 'react';

import { computeContainSize } from './computeContainSize';

import type { RefObject } from 'react';

/**
 * Keeps the source image and its marker overlay inside one pixel-identical
 * contain box. Crop consumers pass the effective natural crop dimensions.
 */
export function useAssemblyProcedureContainBox(
  viewportRef: RefObject<HTMLElement | null>,
  naturalWidth: number,
  naturalHeight: number
): { width: number; height: number } {
  const [box, setBox] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const update = () => {
      const rect = element.getBoundingClientRect();
      const next = computeContainSize(rect.width, rect.height, naturalWidth, naturalHeight);
      setBox((current) =>
        Math.abs(current.width - next.width) < 0.5 &&
        Math.abs(current.height - next.height) < 0.5
          ? current
          : next
      );
    };

    update();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [naturalHeight, naturalWidth, viewportRef]);

  return box;
}
