import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { normalizeMachineName } from '../productionSchedule/machineName';
import '../inventory/inventoryHoverCard.css';

import type { HaizenOverviewRow, MobilePlacementRegisteredShelfEntry } from '../../../api/domains/mobile-placement';

export function HaizenShelfHoverCard({ id, shelf, rows, hitIds, rect }: {
  id: string;
  shelf: MobilePlacementRegisteredShelfEntry;
  rows: HaizenOverviewRow[];
  hitIds: Set<string>;
  rect: DOMRect;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: rect.right + 12, top: rect.top });
  useLayoutEffect(() => {
    if (!ref.current) return;
    const { width, height } = ref.current.getBoundingClientRect();
    const left = rect.right + 12 + width <= window.innerWidth - 8 ? rect.right + 12 : rect.left - width - 12;
    setPosition({
      left: Math.max(8, Math.min(left, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(rect.top, window.innerHeight - height - 8))
    });
  }, [rect]);
  const sorted = [...rows.filter(row => hitIds.has(`${row.source}:${row.id}`)), ...rows.filter(row => !hitIds.has(`${row.source}:${row.id}`))];
  return createPortal(<div ref={ref} id={id} role="tooltip" style={position} className="pointer-events-none fixed z-50 w-[520px] max-w-[calc(100vw-16px)] text-inv-text">
    <div className="inventory-hover-card flex max-h-[calc(100dvh-16px)] flex-col gap-3 overflow-hidden rounded-[20px] border border-inv-cyan/[.55] bg-gradient-to-b from-[#273650] to-[#1f2b3d] p-3.5 shadow-[0_30px_70px_rgba(0,0,0,.7),0_0_0_4px_rgba(57,208,240,.10)] motion-reduce:animate-none">
      <div className="flex items-baseline gap-3"><strong className="break-all font-mono text-2xl">{shelf.displayLabel || shelf.shelfCodeRaw}</strong><span className="shrink-0 text-inv-muted">{rows.length ? `${rows.length}件` : '空き'}</span></div>
      {rows.length ? <table className="w-full table-fixed text-left text-[15px]">
        <thead><tr>{['製番', '品名', '品番', '機種名'].map(label => <th key={label} className="pb-1 pr-2 text-xs font-bold text-inv-faint">{label}</th>)}</tr></thead>
        <tbody>{sorted.slice(0, 15).map(row => <tr key={`${row.source}:${row.id}`} className={hitIds.has(`${row.source}:${row.id}`) ? 'bg-inv-cyan/10 font-bold text-inv-cyan' : ''}>
          {[row.fseiban, row.fhinmei, row.fhincd, normalizeMachineName(row.machineName)].map((value, index) => <td key={index} className={`break-words border-t border-inv-line py-1 pr-2 ${index === 1 ? 'font-bold' : 'font-mono'}`}>{value || '—'}</td>)}
        </tr>)}</tbody>
      </table> : <p className="text-center text-inv-muted">この棚には何も置かれていません</p>}
      {rows.length > 15 && <p className="text-center text-sm text-inv-muted">ほか {rows.length - 15} 件（押すと全部見られます）</p>}
    </div>
  </div>, document.body);
}
