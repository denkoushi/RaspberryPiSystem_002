import { compassDirections, displayName, shelfPosition } from './shelfKioskModel';
import { useShelfLandmarkEditor } from './useShelfLandmarkEditor';

import type { KioskShelf, Landmark } from './shelfKioskModel';

export function ShelfLandmarkList({ marks, shelves, selected, onSelect }: { marks: Landmark[]; shelves: KioskShelf[]; selected?: string; onSelect: (name: string) => void }) {
  const editor = useShelfLandmarkEditor({ onSelect, onDelete: () => onSelect('') });
  return <section className="sk-marks" aria-label="目安"><div className="sk-mark-list">{marks.map((mark) => {
    const own = shelves.filter((shelf) => { const pos = shelfPosition(shelf.shelfCodeRaw, marks); return mark.other ? !pos : pos?.machine === mark.name; });
    return <div className="sk-mark-row" key={mark.name}><button type="button" className="sk-mark" aria-pressed={selected === mark.name} onClick={() => onSelect(mark.name)}>
      <span className="sk-mini" aria-hidden>{compassDirections.map((d, i) => <i key={i} className={!d ? 'center' : own.some((s) => shelfPosition(s.shelfCodeRaw, marks)?.direction === d) ? 'on' : ''} />)}</span>
      <span><strong>{displayName(mark.name)}</strong><small>{mark.kind}</small></span><b>{own.length}</b></button>
      {mark.kind === '目安' && !own.length && <button type="button" className="sk-delete" disabled={editor.busy} aria-label={`${displayName(mark.name)} を消す`} onClick={() => { if (editor.confirmDelete === mark.name) void editor.change(mark.name); else editor.setConfirmDelete(mark.name); }}>{editor.confirmDelete === mark.name ? '消す' : '×'}</button>}
    </div>;
  })}</div><form className="sk-add" onSubmit={(e) => { e.preventDefault(); void editor.change(); }}><input aria-label="目安を追加" placeholder="目安を追加" maxLength={30} value={editor.name} disabled={editor.busy} onChange={(e) => editor.setName(e.target.value)} /><button type="submit" aria-label="目安を追加" disabled={editor.busy || !editor.name.trim()}>＋</button></form>{editor.error && <p role="alert">{editor.error}</p>}</section>;
}
