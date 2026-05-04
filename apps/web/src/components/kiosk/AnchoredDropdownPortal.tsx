import { useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { computeAnchoredPanelLeftEdge } from './anchoredDropdownViewportClamp';

import type { CSSProperties, MutableRefObject, ReactNode } from 'react';

type AnchoredDropdownPortalProps = {
  isOpen: boolean;
  id: string;
  ariaLabel: string;
  anchorRef: MutableRefObject<HTMLElement | null>;
  panelRef: MutableRefObject<HTMLDivElement | null>;
  className: string;
  children: ReactNode;
  offsetY?: number;
  /** 指定時は `z-40` の代わりにインライン z-index（左ドロワー z-50 より手前に出す等） */
  fixedZIndex?: number;
  /**
   * When true (default), panel `left` is the left edge and stays inside the viewport
   * while keeping the right edge aligned to the anchor when possible.
   */
  clampToViewport?: boolean;
  /** Horizontal inset used with {@link clampToViewport} (default 16). */
  viewportPaddingPx?: number;
};

type AnchorPosition = {
  top: number;
  left: number;
  transform: CSSProperties['transform'];
};

const DEFAULT_OFFSET_Y = 8;
const DEFAULT_VIEWPORT_PADDING_PX = 16;

const resolveAnchorPosition = (
  anchorRef: MutableRefObject<HTMLElement | null>,
  panelRef: MutableRefObject<HTMLDivElement | null>,
  offsetY: number,
  clampToViewport: boolean,
  viewportPaddingPx: number
): AnchorPosition | null => {
  const anchor = anchorRef.current;
  if (!anchor) return null;
  const rect = anchor.getBoundingClientRect();
  const top = rect.bottom + offsetY;

  if (!clampToViewport) {
    return {
      top,
      left: rect.right,
      transform: 'translateX(-100%)'
    };
  }

  const panel = panelRef.current;
  const panelWidth = panel?.getBoundingClientRect().width ?? 0;

  if (panelWidth <= 0) {
      return {
        top,
        left: rect.right,
        transform: 'translateX(-100%)'
      };
    }

  return {
    top,
    left: computeAnchoredPanelLeftEdge({
      anchorRight: rect.right,
      panelWidth,
      viewportWidth: window.innerWidth,
      padding: viewportPaddingPx
    }),
    transform: 'none'
  };
};

export function AnchoredDropdownPortal({
  isOpen,
  id,
  ariaLabel,
  anchorRef,
  panelRef,
  className,
  children,
  offsetY = DEFAULT_OFFSET_Y,
  fixedZIndex,
  clampToViewport = true,
  viewportPaddingPx = DEFAULT_VIEWPORT_PADDING_PX
}: AnchoredDropdownPortalProps) {
  const [position, setPosition] = useState<AnchorPosition | null>(null);

  useLayoutEffect(() => {
    if (!isOpen) {
      setPosition(null);
      return undefined;
    }

    let cancelled = false;

    const updatePosition = () => {
      if (cancelled) return;
      const next = resolveAnchorPosition(
        anchorRef,
        panelRef,
        offsetY,
        clampToViewport,
        viewportPaddingPx
      );
      setPosition(next);

      // First open: portal was not mounted yet, so panel width was 0 → fall back to legacy
      // transform. Double rAF waits for layout so we can measure and apply viewport clamp.
      if (clampToViewport && next != null && next.transform === 'translateX(-100%)') {
        requestAnimationFrame(() => {
          if (cancelled) return;
          requestAnimationFrame(() => {
            if (cancelled) return;
            const refined = resolveAnchorPosition(
              anchorRef,
              panelRef,
              offsetY,
              clampToViewport,
              viewportPaddingPx
            );
            if (refined != null) {
              setPosition(refined);
            }
          });
        });
      }
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      cancelled = true;
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [anchorRef, panelRef, isOpen, offsetY, clampToViewport, viewportPaddingPx]);

  if (!isOpen || typeof document === 'undefined') return null;
  if (!position) return null;

  const style: CSSProperties = {
    top: `${position.top}px`,
    left: `${position.left}px`,
    transform: position.transform,
    ...(fixedZIndex !== undefined ? { zIndex: fixedZIndex } : {})
  };

  const zClass = fixedZIndex === undefined ? 'z-40' : '';

  return createPortal(
    <div
      ref={panelRef}
      id={id}
      role="dialog"
      aria-label={ariaLabel}
      className={`fixed ${zClass} ${className}`.trim().replace(/\s+/g, ' ')}
      style={style}
    >
      {children}
    </div>,
    document.body
  );
}
