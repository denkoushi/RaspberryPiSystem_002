import clsx from 'clsx';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { pageZoom } from './pageZoom';

function DropdownPanel<T extends string>({ anchor, options, value, ariaLabel, onSelect, onClose }: {
  anchor: HTMLElement;
  options: readonly { value: T; label: string }[];
  value: T;
  ariaLabel: string;
  onSelect: (value: T) => void;
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  useLayoutEffect(() => {
    if (!panel.current) return;
    const rect = anchor.getBoundingClientRect();
    const bounds = panel.current.getBoundingClientRect();
    const zoom = pageZoom();
    setPosition({ left: Math.max(8, Math.min(rect.left / zoom, (window.innerWidth - bounds.width) / zoom - 8)),
      top: Math.max(8, Math.min(rect.bottom / zoom + 4, (window.innerHeight - bounds.height) / zoom - 8)) });
    (panel.current.querySelector<HTMLButtonElement>('[aria-pressed="true"]') ?? panel.current.querySelector('button'))?.focus();
    return () => anchor.focus();
  }, [anchor]);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !panel.current?.contains(event.target) && !anchor.contains(event.target)) onClose();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('[role="dialog"]')) { event.preventDefault(); onClose(); }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', onClose);
    const scroll = (event: Event) => {
      if (event.target === document || event.target instanceof Element && event.target.contains(anchor)) onClose();
    };
    window.addEventListener('scroll', scroll, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('scroll', scroll, true);
    };
  }, [anchor, onClose]);
  return createPortal(<div ref={panel} data-planning-board-popover role="group" aria-label={ariaLabel} style={position}
    className="fixed z-[100] grid max-h-[min(70dvh,520px)] min-w-28 max-w-[calc(100vw-16px)] gap-1 overflow-auto rounded-lg border border-slate-600 bg-slate-900 p-1 text-slate-100 shadow-xl">
    {options.map((option) => <button key={option.value} type="button" aria-pressed={value === option.value}
      onClick={() => onSelect(option.value)} className={clsx('flex min-h-11 items-center rounded-md px-3 text-left text-[13px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300',
        value === option.value ? 'bg-slate-100 text-slate-950' : 'hover:bg-slate-800')}>
      {option.label}
    </button>)}
  </div>, document.body);
}

export function PlanningBoardDropdown<T extends string>({ ariaLabel, options, value, closedLabel, disabled = false, onChange }: {
  ariaLabel: string;
  options: readonly { value: T; label: string }[];
  value: T;
  closedLabel: string;
  disabled?: boolean;
  onChange: (value: T) => void;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  return <div className="flex shrink-0 items-center rounded-[9px] border border-slate-700 bg-slate-900 p-0.5">
    <button ref={button} type="button" aria-label={ariaLabel} aria-expanded={open && !disabled}
      disabled={disabled} onClick={() => setOpen((current) => !current)}
      className="flex min-h-11 items-center gap-2 rounded-md bg-slate-100 px-2 text-[13px] font-bold text-slate-950 disabled:cursor-not-allowed disabled:opacity-55 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300">
      {closedLabel}<span aria-hidden="true" className="text-[10px]">▾</span>
    </button>
    {open && !disabled && button.current && <DropdownPanel anchor={button.current} ariaLabel={ariaLabel} options={options} value={value}
      onSelect={(next) => { onChange(next); setOpen(false); }} onClose={() => setOpen(false)} />}
  </div>;
}
