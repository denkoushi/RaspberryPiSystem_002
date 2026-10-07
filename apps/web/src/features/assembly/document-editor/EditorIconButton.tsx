import { useEffect, useRef, useState } from 'react';

import type { ReactNode } from 'react';

type Props = {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  className?: string;
  badge?: number | null;
  tipSide: 'left' | 'top';
  target?: string;
};

export function EditorIconButton({ label, icon, onClick, disabled, pressed, className, badge, tipSide, target }: Props) {
  const [tipVisible, setTipVisible] = useState(false);
  const [tipPosition, setTipPosition] = useState<{ right: number; top: number } | null>(null);
  const showTimer = useRef<ReturnType<typeof setTimeout>>();
  const hideTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => {
    clearTimeout(showTimer.current);
    clearTimeout(hideTimer.current);
  }, []);

  const positionTip = (button: HTMLButtonElement) => {
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

  return <button
    type="button"
    aria-label={label}
    aria-pressed={pressed}
    disabled={disabled}
    data-kiosk-sop-target={target}
    data-tip={tipVisible ? 'true' : undefined}
    onClick={onClick}
    onPointerEnter={event => positionTip(event.currentTarget)}
    onFocus={event => positionTip(event.currentTarget)}
    onPointerDown={event => {
      if (event.pointerType === 'mouse' || disabled) return;
      positionTip(event.currentTarget);
      clearTimeout(showTimer.current);
      clearTimeout(hideTimer.current);
      showTimer.current = setTimeout(() => setTipVisible(true), 500);
    }}
    onPointerUp={releaseTip}
    onPointerLeave={releaseTip}
    onPointerCancel={releaseTip}
    className={`group relative grid h-12 w-12 shrink-0 place-items-center rounded-[10px] border border-[#344252] text-[#eef3f6] disabled:opacity-40 aria-pressed:bg-[#27313b] ${className ?? ''}`}
  >
    <svg aria-hidden="true" className="h-[26px] w-[26px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">{icon}</svg>
    {badge != null && badge > 0 ? <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-[#f6b93b] px-1 text-[13px] font-black text-[#0b1a12]">{badge}</span> : null}
    <span
      role="tooltip"
      style={tipSide === 'left' && tipPosition ? { position: 'fixed', ...tipPosition } : undefined}
      className={`pointer-events-none absolute z-50 flex h-10 items-center whitespace-nowrap rounded-lg border border-[#344252] bg-[#161c22]/[0.98] px-[14px] text-lg font-bold text-[#eef3f6] shadow-[0_10px_30px_rgba(0,0,0,0.45)] invisible opacity-0 [@media(hover:hover)]:group-hover:visible [@media(hover:hover)]:group-hover:opacity-100 group-focus-visible:visible group-focus-visible:opacity-100 group-data-[tip=true]:visible group-data-[tip=true]:opacity-100 after:absolute after:h-[10px] after:w-[10px] after:border-r after:border-t after:border-[#344252] after:bg-[#161c22]/[0.98] after:content-[''] ${tipSide === 'left'
        ? 'right-[62px] top-1/2 -translate-y-1/2 after:-right-[6px] after:top-1/2 after:-translate-y-1/2 after:rotate-45'
        : 'left-1/2 top-[-46px] -translate-x-1/2 after:-bottom-[6px] after:left-1/2 after:-translate-x-1/2 after:rotate-[135deg]'}`}
    >{label}</span>
  </button>;
}
