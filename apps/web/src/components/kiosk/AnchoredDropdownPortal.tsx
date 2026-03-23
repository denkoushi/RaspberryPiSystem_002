import { useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import type { CSSProperties, ReactNode, RefObject } from 'react';

type AnchoredDropdownPortalProps = {
  isOpen: boolean;
  id: string;
  ariaLabel: string;
  anchorRef: RefObject<HTMLElement | null>;
  panelRef: RefObject<HTMLDivElement | null>;
  className: string;
  children: ReactNode;
  offsetY?: number;
};

type AnchorPosition = {
  top: number;
  left: number;
};

const DEFAULT_OFFSET_Y = 8;

const resolveAnchorPosition = (
  anchorRef: RefObject<HTMLElement | null>,
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
  offsetY = DEFAULT_OFFSET_Y
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
    transform: 'translateX(-100%)'
  };

  return createPortal(
    <div
      ref={panelRef}
      id={id}
      role="dialog"
      aria-label={ariaLabel}
      className={`fixed z-40 ${className}`}
      style={style}
    >
      {children}
    </div>,
    document.body
  );
}
