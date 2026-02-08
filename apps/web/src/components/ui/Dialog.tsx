import clsx from 'clsx';
import { useEffect, useId, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';

import type { MouseEvent, PropsWithChildren, RefObject } from 'react';

type DialogSize = 'sm' | 'md' | 'lg' | 'full';

type DialogProps = PropsWithChildren<{
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  ariaLabel?: string;
  closeOnEsc?: boolean;
  closeOnBackdrop?: boolean;
  lockScroll?: boolean;
  trapFocus?: boolean;
  returnFocus?: boolean;
  initialFocusRef?: RefObject<HTMLElement>;
  size?: DialogSize;
  className?: string;
}>;

const focusableSelector =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

const getFocusableElements = (container: HTMLElement | null) => {
  if (!container) return [];
  const elements = Array.from(container.querySelectorAll<HTMLElement>(focusableSelector));
  return elements.filter((element) => element.offsetParent !== null);
};

const sizeClassMap: Record<DialogSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-3xl',
  full: 'w-[calc(100vw-2rem)] max-w-none'
};

export function Dialog({
  isOpen,
  onClose,
  title,
  description,
  ariaLabel,
  closeOnEsc = true,
  closeOnBackdrop = true,
  lockScroll = true,
  trapFocus = true,
  returnFocus = true,
  initialFocusRef,
  size = 'md',
  className,
  children
}: DialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);

  const ariaAttributes = useMemo(() => {
    if (ariaLabel) {
      return { 'aria-label': ariaLabel };
    }
    if (title) {
      return { 'aria-labelledby': titleId };
    }
    return { 'aria-label': 'dialog' };
  }, [ariaLabel, title, titleId]);

  useEffect(() => {
    if (!isOpen) return;
    if (!lockScroll) return;
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
    };
  }, [isOpen, lockScroll]);

  useEffect(() => {
    if (!isOpen) return;
    previousActiveElementRef.current = document.activeElement as HTMLElement | null;
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const focusTarget = initialFocusRef?.current ?? getFocusableElements(panelRef.current)[0] ?? panelRef.current;
    focusTarget?.focus();
  }, [isOpen, initialFocusRef]);

  useEffect(() => {
    if (!isOpen || !returnFocus) return;
    return () => {
      previousActiveElementRef.current?.focus();
    };
  }, [isOpen, returnFocus]);

  useEffect(() => {
    if (!isOpen || !closeOnEsc) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen, closeOnEsc, onClose]);

  useEffect(() => {
    if (!isOpen || !trapFocus) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const focusable = getFocusableElements(panelRef.current);
      if (focusable.length === 0) {
        event.preventDefault();
        panelRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen, trapFocus]);

  const handleBackdropMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (!closeOnBackdrop) return;
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4"
      onMouseDown={handleBackdropMouseDown}
      role="dialog"
      aria-modal="true"
      {...ariaAttributes}
      aria-describedby={description ? descriptionId : undefined}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className={clsx(
          'w-full rounded-xl border-2 border-slate-500 bg-white p-4 text-slate-900 shadow-lg max-h-[calc(100vh-2rem)] my-4',
          sizeClassMap[size],
          className
        )}
      >
        {title ? <h2 id={titleId} className="text-lg font-semibold">{title}</h2> : null}
        {description ? (
          <p id={descriptionId} className={clsx('text-sm text-slate-600', title ? 'mt-2' : undefined)}>
            {description}
          </p>
        ) : null}
        {children}
      </div>
    </div>,
    document.body
  );
}
