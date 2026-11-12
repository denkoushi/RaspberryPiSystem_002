import clsx from 'clsx';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { haizenPhoneStyle, hp } from '../ui/haizenPhoneTokens';

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
    setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - bounds.width - 8)),
      top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - bounds.height - 8)) });
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
  return createPortal(<div ref={panel} role="group" aria-label={ariaLabel} style={{ ...haizenPhoneStyle, ...position }}
    className="fixed z-[100] grid max-h-[70dvh] max-w-[calc(100vw-16px)] gap-0.5 overflow-auto rounded-xl border border-[var(--hp-line)] bg-[var(--hp-panel2)] p-1 text-[var(--hp-ink)] shadow-xl">
    {options.map((option) => <button key={option.value} type="button" aria-pressed={value === option.value}
      onClick={() => onSelect(option.value)} className={clsx('flex min-h-11 items-center whitespace-nowrap rounded-[9px] px-3 text-left text-[15px] font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--hp-ink)]',
        value === option.value ? 'bg-[color-mix(in_srgb,var(--hp-panel)_70%,var(--hp-shelf))]' : '')}>
      {option.label}
    </button>)}
  </div>, document.body);
}

export function HaizenScheduleDropdown<T extends string>({ ariaLabel, options, value, closedLabel, onChange }: {
  ariaLabel: string;
  options: readonly { value: T; label: string }[];
  value: T;
  closedLabel: string;
  onChange: (value: T) => void;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return <div className="flex shrink-0 items-center">
    <button ref={button} type="button" aria-label={ariaLabel} aria-expanded={open}
      onClick={() => setOpen((current) => !current)}
      className={`${hp.segment} flex items-center gap-1 !px-2.5 !text-[14px]`}>
      {closedLabel}<span aria-hidden="true" className="text-[var(--hp-ink2)]">▾</span>
    </button>
    {open && button.current && <DropdownPanel anchor={button.current} ariaLabel={ariaLabel} options={options} value={value}
      onSelect={(next) => { onChange(next); setOpen(false); }} onClose={() => setOpen(false)} />}
  </div>;
}
