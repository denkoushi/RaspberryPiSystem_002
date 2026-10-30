import { ShelfPhoto } from '../../shelfPhoto/ShelfPhoto';

import { compassDirections, displayName, shelfPosition } from './shelfKioskModel';

import type { KioskShelf, Landmark } from './shelfKioskModel';
import type { ShelfDirection } from '@raspi-system/shelf-layout-core';

export function KioskShelfPhoto({ item, className }: { item: KioskShelf; className?: string }) {
  return item.record ? <img className={className} alt={`${displayName(item.shelfCodeRaw)} の写真`} src={`data:${item.record.photo.contentType};base64,${item.record.photo.dataBase64}`} /> : item.shelf ? <ShelfPhoto shelf={item.shelf} label={displayName(item.shelfCodeRaw)} className={className} /> : null;
}
export function ShelfCompass({ mark, marks, shelves, selectedCode, selectedDirection, devices, onShelf, onNew }: { mark?: Landmark; marks: Landmark[]; shelves: KioskShelf[]; selectedCode?: string; selectedDirection?: ShelfDirection | '' | null; devices: { name: string; shelfCodeRaw: string | null }[]; onShelf: (shelf: KioskShelf) => void; onNew: (direction: ShelfDirection | '') => void }) {
  const own = shelves.filter((s) => { const pos = shelfPosition(s.shelfCodeRaw, marks); return mark?.other ? !pos : pos?.machine === mark?.name; });
  const tile = (item: KioskShelf, direction?: string) => <button type="button" key={item.shelfCodeRaw} className="sk-cell" aria-label={`棚 ${displayName(item.shelfCodeRaw)} を編集`} aria-pressed={selectedCode === item.shelfCodeRaw} disabled={item.record?.status === 'pending'} onClick={() => onShelf(item)}><KioskShelfPhoto item={item} /><span className="sk-shade" /><b className="sk-dir">{direction}</b><span className="sk-code">{displayName(item.shelfCodeRaw)}</span>{devices.find((d) => d.shelfCodeRaw === item.shelfCodeRaw) && <span className="sk-zw">{devices.find((d) => d.shelfCodeRaw === item.shelfCodeRaw)?.name}</span>}{item.record && <span className="sk-pending sk-badge">{item.record.status === 'pending' ? '未送信' : '要確認'}</span>}</button>;
  if (!mark) return <section aria-label="方角" />;
  if (mark.other) return <section className="sk-other" aria-label="その他">{own.map((s) => tile(s))}</section>;
  return <section className="sk-field" aria-label="方角"><div className="sk-compass">{compassDirections.map((d) => {
    if (!d) return <div key="hub" className="sk-hub"><small>{mark.kind}</small><strong>{displayName(mark.name)}</strong></div>;
    const item = own.find((s) => shelfPosition(s.shelfCodeRaw, marks)?.direction === d);
    return item ? tile(item, d) : <button type="button" key={d} className="sk-cell sk-empty" aria-pressed={selectedDirection === d} aria-label={`${displayName(mark.name)} ${d} に棚を追加`} onClick={() => onNew(d)}><span>＋</span><b>{d}</b></button>;
  })}</div><div className="sk-loose"><b>方角なし</b><div>{own.filter((s) => shelfPosition(s.shelfCodeRaw, marks)?.direction === '').map((s) => tile(s))}{!own.some((s) => shelfPosition(s.shelfCodeRaw, marks)?.direction === '') && <button type="button" aria-pressed={selectedDirection === ''} aria-label={`${displayName(mark.name)} 方角なしに棚を追加`} onClick={() => onNew('')}>＋</button>}</div></div></section>;
}
