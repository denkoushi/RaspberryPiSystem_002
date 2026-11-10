import clsx from 'clsx';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { pageZoom } from './pageZoom';

export function PlanningBoardSingleResourcePicker({ anchor, resources, resourceCd, resourceNameMap, onSelect, onClose, isDisabled, placement = 'bottom' }: {
  placement?: 'bottom' | 'right';
  isDisabled?: (resource: string) => boolean;
  anchor: HTMLElement;
  resources: readonly string[];
  resourceCd: string | null;
  resourceNameMap: Record<string, string[]>;
  onSelect: (resource: string) => void;
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  useLayoutEffect(() => {
    if (!panel.current) return;
    const rect = anchor.getBoundingClientRect();
    const bounds = panel.current.getBoundingClientRect();
    const zoom = pageZoom();
    setPosition(placement === 'right' ? { left: rect.right / zoom + 6, top: Math.max(16, Math.min(rect.top / zoom, (window.innerHeight - bounds.height) / zoom - 16)) } : { left: Math.max(8, Math.min(rect.left / zoom, (window.innerWidth - bounds.width) / zoom - 8)),
      top: Math.max(8, Math.min(rect.bottom / zoom + 4, (window.innerHeight - bounds.height) / zoom - 8)) });
    (panel.current.querySelector<HTMLButtonElement>('button[aria-pressed="true"]:not(:disabled)') ?? panel.current.querySelector<HTMLButtonElement>('button:not(:disabled)'))?.focus();
    return () => anchor.focus();
  }, [anchor, placement]);
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
    const scroll = (event: Event) => { if (!(event.target instanceof Node) || !panel.current?.contains(event.target)) onClose(); };
    window.addEventListener('scroll', scroll, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('scroll', scroll, true);
    };
  }, [anchor, onClose]);
  return createPortal(<div ref={panel} data-planning-board-popover role="group" aria-label="1台の資源CD" style={position}
    className="fixed z-[100] grid max-h-[min(70dvh,520px)] w-[min(660px,calc(100vw-32px))] grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-1.5 overflow-auto rounded-lg border border-slate-600 bg-slate-900 p-2 text-slate-100 shadow-xl">
    {resources.map((resource) => <button key={resource} type="button" aria-pressed={resourceCd === resource}
      disabled={isDisabled?.(resource)} onClick={() => onSelect(resource)} className={clsx('disabled:bg-slate-800 disabled:text-slate-500 disabled:opacity-40 flex h-[60px] items-center gap-3 rounded-md px-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-300',
        resourceCd === resource ? 'bg-sky-400 text-slate-950' : isDisabled?.(resource) ? 'hover:bg-slate-800' : 'border border-slate-700 bg-slate-900 hover:bg-slate-800')}>
      <b className="font-mono text-xl">{resource}</b><span className={clsx('truncate text-sm', resourceCd !== resource && !isDisabled?.(resource) && 'font-bold text-slate-300')}>{resourceNameMap[resource]?.join(' / ')}</span>
    </button>)}
  </div>, document.body);
}
