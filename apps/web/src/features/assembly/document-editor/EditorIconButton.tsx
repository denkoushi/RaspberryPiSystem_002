import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { AiUnavailableBadge } from '../../../components/ui/AiUnavailableBadge';
import { IconTooltipBubble, useIconTooltip } from '../../../components/ui/IconActionTooltip';

import type { ReactNode } from 'react';

type Props = {
  label: string;
  aiUnavailable?: boolean;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  className?: string;
  badge?: number | null;
  tipSide: 'left' | 'top';
  target?: string;
};

export function EditorIconButton({ label, icon, onClick, disabled, pressed, className, badge, tipSide, target, aiUnavailable }: Props) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const { tipVisible, tipPosition, positionTip, releaseTip, onPointerDown, hideTip } = useIconTooltip(tipSide, tipSide === 'left' ? false : disabled);
  useEffect(() => {
    const hide = () => { setHovered(false); setFocused(false); hideTip(); };
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => { window.removeEventListener('scroll', hide, true); window.removeEventListener('resize', hide); };
  });
  return <span className={`inline-flex shrink-0 ${tipSide === 'left' ? '[&_button:disabled]:pointer-events-none' : ''}`} tabIndex={disabled && tipSide === 'left' ? 0 : undefined}
    onPointerEnter={event => { if (tipSide === 'left') { positionTip(event.currentTarget); setHovered(window.matchMedia?.('(hover: hover)').matches ?? true); } }}
    onPointerLeave={() => { setHovered(false); releaseTip(); }}
    onFocus={event => { if (tipSide === 'left') { positionTip(event.currentTarget); setFocused(event.target.matches(':focus-visible')); } }}
    onBlur={() => { setFocused(false); hideTip(); }}
    onPointerDown={tipSide === 'left' ? onPointerDown : undefined}
    onPointerUp={tipSide === 'left' ? releaseTip : undefined}
    onPointerCancel={tipSide === 'left' ? releaseTip : undefined}
  ><AiUnavailableBadge unavailable={aiUnavailable} positioned><button
    type="button"
    aria-label={label}
    aria-pressed={pressed}
    disabled={disabled}
    data-kiosk-sop-target={target}
    data-tip={tipVisible ? 'true' : undefined}
    onClick={onClick}
    onPointerEnter={event => positionTip(event.currentTarget)}
    onFocus={event => positionTip(event.currentTarget)}
    onPointerDown={tipSide === 'top' ? onPointerDown : undefined}
    onPointerUp={releaseTip}
    onPointerLeave={releaseTip}
    onPointerCancel={releaseTip}
    className={`group relative grid h-12 w-12 shrink-0 place-items-center rounded-[10px] border border-[#344252] text-[#eef3f6] disabled:opacity-40 aria-pressed:bg-[#27313b] ${className ?? ''}`}
  >
    <svg aria-hidden="true" className="h-[26px] w-[26px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">{icon}</svg>
    {badge != null && badge > 0 ? <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-[#f6b93b] px-1 text-[13px] font-black text-[#0b1a12]">{badge}</span> : null}
    {!aiUnavailable && tipSide !== 'left' ? <IconTooltipBubble label={label} tipSide={tipSide} tipPosition={tipPosition} /> : null}
  </button></AiUnavailableBadge>{!aiUnavailable && tipSide === 'left' && tipPosition && (hovered || focused || tipVisible)
    ? createPortal(<IconTooltipBubble label={label} tipSide="left" tipPosition={tipPosition} portaled />, document.body) : null}</span>;
}
