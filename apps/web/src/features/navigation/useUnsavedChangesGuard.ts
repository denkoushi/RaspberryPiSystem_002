import { useEffect } from 'react';

export const DEFAULT_UNSAVED_NAVIGATION_MESSAGE =
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
    return new URL(anchor.href, window.location.href).origin === window.location.origin;
  } catch {
    return false;
  }
}

/**
 * Browser離脱と同一画面内の通常リンク移動を共通に保護する。
 * 命令的なnavigateは呼出側でconfirmNavigationを使う。
 */
export function useUnsavedChangesGuard(
  shouldBlock: boolean,
  message = DEFAULT_UNSAVED_NAVIGATION_MESSAGE
): { confirmNavigation: () => boolean } {
  useEffect(() => {
    if (!shouldBlock || typeof window === 'undefined') return undefined;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    const handleDocumentClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      const anchor = findAnchor(event.target);
      if (!anchor || !isInternalSameWindowNavigation(anchor)) return;
      if (window.confirm(message)) return;
      event.preventDefault();
      event.stopPropagation();
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('click', handleDocumentClick, true);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('click', handleDocumentClick, true);
    };
  }, [message, shouldBlock]);

  return {
    confirmNavigation: () => !shouldBlock || window.confirm(message)
  };
}
