import clsx from 'clsx';
import { createPortal } from 'react-dom';

import type { PropsWithChildren } from 'react';

type FullScreenOverlayProps = PropsWithChildren<{
  isVisible: boolean;
  message?: string;
  className?: string;
}>;

export function FullScreenOverlay({
  isVisible,
  message,
  className,
  children
}: FullScreenOverlayProps) {
  if (!isVisible) return null;

  return createPortal(
    <div
      className={clsx(
        'fixed inset-0 z-[9999] flex items-center justify-center bg-black text-white',
        className
      )}
      role="status"
      aria-live="polite"
      style={{ pointerEvents: 'auto' }}
    >
      {message ? <p className="text-xl font-medium">{message}</p> : children}
    </div>,
    document.body
  );
}
