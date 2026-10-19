import { useEffect } from 'react';

import type { RefObject } from 'react';

/** 開いている間だけ、要素の外側の押下と Escape で `onDismiss` を呼ぶ。 */
export function useDismissOnOutside(ref: RefObject<HTMLElement>, open: boolean, onDismiss: () => void) {
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onDismiss();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [ref, open, onDismiss]);
}
