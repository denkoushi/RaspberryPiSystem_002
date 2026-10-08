import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import type { CSSProperties, ReactNode } from 'react';

export function useIconTooltip(tipSide: 'left' | 'top', disabled = false) {
  const [tipVisible, setTipVisible] = useState(false);
  const [tipPosition, setTipPosition] = useState<{ right: number; top: number } | null>(null);
  const showTimer = useRef<ReturnType<typeof setTimeout>>();
  const hideTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => {
    clearTimeout(showTimer.current);
    clearTimeout(hideTimer.current);
  }, []);

  const positionTip = (button: HTMLElement) => {
    if (tipSide !== 'left') return;
    // Keep the left tip outside the scrolling rail's clipping area.
    const rect = button.getBoundingClientRect();
    setTipPosition({ right: window.innerWidth - rect.right + 62, top: rect.top + rect.height / 2 });
  };
  const releaseTip = () => {
    clearTimeout(showTimer.current);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setTipVisible(false), 1200);
  };

  return { tipVisible, tipPosition, positionTip, releaseTip,
    hideTip: () => { clearTimeout(showTimer.current); clearTimeout(hideTimer.current); setTipVisible(false); },
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
      if (event.pointerType === 'mouse' || disabled) return;
      positionTip(event.currentTarget);
      clearTimeout(showTimer.current);
      clearTimeout(hideTimer.current);
      showTimer.current = setTimeout(() => setTipVisible(true), 500);
    }
  };
}

type BubbleProps = {
  label: string;
  tipSide: 'left' | 'top';
  tipPosition?: { right: number; top: number } | null;
  floating?: { left: number; top: number; below: boolean };
};

export function IconTooltipBubble({ label, tipSide, tipPosition, floating }: BubbleProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [left, setLeft] = useState(floating?.left ?? 0);
  useLayoutEffect(() => {
    if (!floating || !ref.current) return;
    const halfWidth = ref.current.getBoundingClientRect().width / 2;
    setLeft(Math.max(halfWidth + 8, Math.min(window.innerWidth - halfWidth - 8, floating.left)));
  }, [floating]);
  const style: CSSProperties | undefined = floating
    ? { position: 'fixed', left, top: floating.top, maxWidth: 'calc(100vw - 16px)' }
    : tipSide === 'left' && tipPosition ? { position: 'fixed', ...tipPosition } : undefined;
  return <span
      ref={ref}
      role="tooltip"
      style={style}
      className={`pointer-events-none absolute z-50 flex h-10 items-center whitespace-nowrap rounded-lg border border-[#344252] bg-[#161c22]/[0.98] px-[14px] text-lg font-bold text-[#eef3f6] shadow-[0_10px_30px_rgba(0,0,0,0.45)] ${floating ? '' : 'invisible opacity-0 [@media(hover:hover)]:group-hover:visible [@media(hover:hover)]:group-hover:opacity-100 group-focus-visible:visible group-focus-visible:opacity-100 group-data-[tip=true]:visible group-data-[tip=true]:opacity-100'} after:absolute after:h-[10px] after:w-[10px] after:border-r after:border-t after:border-[#344252] after:bg-[#161c22]/[0.98] after:content-[''] ${floating ? `-translate-x-1/2 ${floating.below ? 'after:-top-[6px] after:rotate-[-45deg]' : 'after:-bottom-[6px] after:rotate-[135deg]'} after:left-1/2 after:-translate-x-1/2` : tipSide === 'left'
        ? 'right-[62px] top-1/2 -translate-y-1/2 after:-right-[6px] after:top-1/2 after:-translate-y-1/2 after:rotate-45'
        : 'left-1/2 top-[-46px] -translate-x-1/2 after:-bottom-[6px] after:left-1/2 after:-translate-x-1/2 after:rotate-[135deg]'}`}
    >{label}</span>;
}

// The wrapper receives pointer events even for disabled buttons/links; the
// bubble lives outside table overflow so the first row remains readable.
export function IconActionTooltip({ label, disabled, children }: { label: string; disabled?: boolean; children: ReactNode }) {
  const tip = useIconTooltip('top');
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [floating, setFloating] = useState<BubbleProps['floating']>();
  const position = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    const below = rect.top < 54;
    setFloating({ left: rect.left + rect.width / 2, top: below ? rect.bottom + 6 : rect.top - 46, below });
  };
  useEffect(() => {
    const hide = () => { setHovered(false); setFocused(false); tip.hideTip(); };
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => { window.removeEventListener('scroll', hide, true); window.removeEventListener('resize', hide); };
  });
  return <span className="inline-flex shrink-0 [&>button:disabled]:pointer-events-none" tabIndex={disabled ? 0 : undefined}
    onPointerEnter={event => { position(event.currentTarget); setHovered(window.matchMedia?.('(hover: hover)').matches ?? true); }}
    onPointerLeave={() => { setHovered(false); tip.releaseTip(); }}
    onFocus={event => { position(event.currentTarget); setFocused(event.target.matches(':focus-visible')); }}
    onBlur={() => setFocused(false)}
    onPointerDown={event => { position(event.currentTarget); tip.onPointerDown(event); }}
    onPointerUp={tip.releaseTip} onPointerCancel={tip.releaseTip}
  >{children}{floating && (hovered || focused || tip.tipVisible)
    ? createPortal(<IconTooltipBubble label={label} tipSide="top" floating={floating} />, document.body) : null}</span>;
}
