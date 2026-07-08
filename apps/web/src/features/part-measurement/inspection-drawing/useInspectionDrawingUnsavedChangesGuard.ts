import { useEffect } from 'react';

const INSPECTION_DRAWING_UNSAVED_NAVIGATION_MESSAGE =
  '保存されていない変更があります。保存せずに移動しますか？';

function findAnchor(target: EventTarget | null): HTMLAnchorElement | null {
  if (!(target instanceof Element)) return null;
  return target.closest('a[href]');
}

function isInternalSameWindowNavigation(anchor: HTMLAnchorElement): boolean {
  if (anchor.download) return false;
  const target = anchor.target.trim().toLowerCase();
  if (target && target !== '_self') return false;
  const href = anchor.getAttribute('href');
  if (!href || href.startsWith('#')) return false;
  try {
    const url = new URL(anchor.href, window.location.href);
    return url.origin === window.location.origin;
  } catch {
    return false;
  }
}

export function useInspectionDrawingUnsavedChangesGuard(shouldBlock: boolean): void {
  useEffect(() => {
    if (!shouldBlock || typeof window === 'undefined') return undefined;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };

    const handleDocumentClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      const anchor = findAnchor(event.target);
      if (!anchor || !isInternalSameWindowNavigation(anchor)) return;
      if (window.confirm(INSPECTION_DRAWING_UNSAVED_NAVIGATION_MESSAGE)) return;
      event.preventDefault();
      event.stopPropagation();
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('click', handleDocumentClick, true);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('click', handleDocumentClick, true);
    };
  }, [shouldBlock]);
}
