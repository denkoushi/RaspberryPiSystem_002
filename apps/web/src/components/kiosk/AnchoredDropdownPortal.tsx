import { useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';

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
};

type AnchorPosition = {
  top: number;
  left: number;
};

const DEFAULT_OFFSET_Y = 8;

const resolveAnchorPosition = (
  anchorRef: MutableRefObject<HTMLElement | null>,
  offsetY: number
): AnchorPosition | null => {
  const anchor = anchorRef.current;
  if (!anchor) return null;
  const rect = anchor.getBoundingClientRect();
  return {
    top: rect.bottom + offsetY,
    left: rect.right
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
  fixedZIndex
}: AnchoredDropdownPortalProps) {
  const [position, setPosition] = useState<AnchorPosition | null>(null);

  useLayoutEffect(() => {
    if (!isOpen) return undefined;

    const updatePosition = () => {
      setPosition(resolveAnchorPosition(anchorRef, offsetY));
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [anchorRef, isOpen, offsetY]);

  if (!isOpen || typeof document === 'undefined') return null;
  if (!position) return null;

  const style: CSSProperties = {
    top: `${position.top}px`,
    left: `${position.left}px`,
    transform: 'translateX(-100%)',
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
