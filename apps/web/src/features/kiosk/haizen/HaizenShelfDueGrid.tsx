import { invCard, invPanel } from '../inventory/inventoryUi';

import { HaizenShelfPhoto } from './HaizenShelfPhoto';

import type { HaizenOverviewRow, MobilePlacementRegisteredShelfEntry } from '../../../api/domains/mobile-placement';

const DUE_DAYS = { red: 3, yellow: 7 };
const dayMs = 86_400_000;

function earliestDue(parts: HaizenOverviewRow[]) {
  return parts.flatMap(part => part.dueDate ? [part.dueDate] : []).sort()[0];
}

function shelfColor(parts: HaizenOverviewRow[], today: Date) {
  const earliest = earliestDue(parts);
  if (!earliest) return 'border-inv-line bg-inv-s1';
  // Compare calendar days against the kiosk's local date, independently of DST.
  const localDay = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const days = (Date.parse(earliest) - localDay) / dayMs;
  return days <= DUE_DAYS.red ? 'border-inv-red bg-inv-red/20' : days <= DUE_DAYS.yellow ? 'border-inv-amber bg-inv-amber/20' : 'border-inv-line bg-inv-s3';
}

export function HaizenShelfDueGrid({ shelves, rows, selectedCode, onSelect }: {
  shelves: MobilePlacementRegisteredShelfEntry[];
  rows: HaizenOverviewRow[];
  selectedCode: string | null;
  onSelect: (code: string) => void;
}) {
  const selected = shelves.find(shelf => shelf.shelfCodeRaw === selectedCode);
  const partsByShelf = new Map<string, HaizenOverviewRow[]>();
  for (const row of rows) {
    if (!partsByShelf.has(row.shelfCodeRaw)) partsByShelf.set(row.shelfCodeRaw, []);
    partsByShelf.get(row.shelfCodeRaw)!.push(row);
  }
  const today = new Date();
  // Shelves without a due date keep the master order after the dated ones.
  const due = (shelf: MobilePlacementRegisteredShelfEntry) => earliestDue(partsByShelf.get(shelf.shelfCodeRaw) ?? []);
  const ordered = shelves.map((shelf, index) => ({ shelf, index, date: due(shelf) })).sort((a, b) =>
    a.date === b.date ? a.index - b.index : !a.date ? 1 : !b.date ? -1 : a.date.localeCompare(b.date)).map(entry => entry.shelf);
  const tiles = ordered.map(shelf => {
    const parts = partsByShelf.get(shelf.shelfCodeRaw) ?? [];
    return <button key={shelf.shelfCodeRaw} type="button" aria-pressed={selectedCode === shelf.shelfCodeRaw}
      className={`rounded-[14px] border flex min-h-16 items-center justify-between gap-3 p-3 text-left ${shelfColor(parts, today)} ${selectedCode === shelf.shelfCodeRaw ? 'ring-2 ring-inv-cyan' : ''}`}
      onClick={() => onSelect(shelf.shelfCodeRaw)}>
      <span className="break-all font-bold">{shelf.displayLabel || shelf.shelfCodeRaw}</span><span className="text-xl font-black tabular-nums">{parts.length}</span>
    </button>;
  });
  const items = [...(selected ? partsByShelf.get(selected.shelfCodeRaw) ?? [] : [])].sort((a, b) =>
    a.dueDate === b.dueDate ? a.id.localeCompare(b.id) : !a.dueDate ? 1 : !b.dueDate ? -1 : a.dueDate.localeCompare(b.dueDate));
  return <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
    <div className="grid grid-cols-3 gap-3">{tiles}</div>
    {selected && <aside className={`${invPanel} min-w-0 overflow-hidden lg:sticky lg:top-0`}>
      <HaizenShelfPhoto key={selected.shelfCodeRaw} shelf={selected} />
      <h2 className="p-3 text-xl font-black">{selected.displayLabel || selected.shelfCodeRaw}</h2>
      <div className="space-y-2 p-3 pt-0">{items.map(row => <article key={`${row.source}:${row.id}`} className={`${invCard} space-y-1 p-3`}>
        <div className="break-all font-mono font-bold">{row.fseiban}</div>
        <div className="break-all font-mono">{row.fhincd}</div>
        <div className="break-words text-xl font-bold">{row.fhinmei}</div>
        {row.dueDate ? <time dateTime={row.dueDate} className="tabular-nums">{row.dueDate}</time> : <span>—</span>}
      </article>)}</div>
    </aside>}
  </div>;
}
