import clsx from 'clsx';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { pageZoom } from './pageZoom';

export function PlanningBoardSingleResourcePicker({ anchor, resources, resourceCd, resourceNameMap, onSelect, onClose }: {
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
    className="fixed z-[100] grid max-h-[min(70dvh,520px)] min-w-64 max-w-[calc(100vw-16px)] gap-1 overflow-auto rounded-lg border border-slate-600 bg-slate-900 p-1 text-slate-100 shadow-xl">
    {resources.map((resource) => <button key={resource} type="button" aria-pressed={resourceCd === resource}
      onClick={() => onSelect(resource)} className={clsx('flex min-h-11 items-center gap-3 rounded-md px-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-300',
        resourceCd === resource ? 'bg-sky-400 text-slate-950' : 'hover:bg-slate-800')}>
      <b className="font-mono text-base">{resource}</b><span className="truncate text-sm">{resourceNameMap[resource]?.join(' / ')}</span>
    </button>)}
  </div>, document.body);
}
