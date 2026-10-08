import { IconTooltipBubble, useIconTooltip } from '../../../components/ui/IconActionTooltip';

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
  const { tipVisible, tipPosition, positionTip, releaseTip, onPointerDown } = useIconTooltip(tipSide, disabled);
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
    onPointerDown={onPointerDown}
    onPointerUp={releaseTip}
    onPointerLeave={releaseTip}
    onPointerCancel={releaseTip}
    className={`group relative grid h-12 w-12 shrink-0 place-items-center rounded-[10px] border border-[#344252] text-[#eef3f6] disabled:opacity-40 aria-pressed:bg-[#27313b] ${className ?? ''}`}
  >
    <svg aria-hidden="true" className="h-[26px] w-[26px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">{icon}</svg>
    {badge != null && badge > 0 ? <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-[#f6b93b] px-1 text-[13px] font-black text-[#0b1a12]">{badge}</span> : null}
    <IconTooltipBubble label={label} tipSide={tipSide} tipPosition={tipPosition} />
  </button>;
}
