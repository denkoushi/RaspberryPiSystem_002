import { Link } from 'react-router-dom';

import { TrailIcon } from '../inventory/InventoryIcons';
import { invButtonGhost } from '../inventory/inventoryUi';
import { normalizeMachineName } from '../productionSchedule/machineName';

import { formatHaizenBranch } from './haizenDueRows';
import { formatHaizenPlacedAt, timeSincePlaced } from './haizenSearch';

import type { HaizenListRow } from './haizenDueRows';
import type { HaizenSearch } from './haizenSearch';
import type { ReactNode } from 'react';

type Props = {
  row: HaizenListRow;
  shelfLabel: string;
  now: number;
  onOpenShelf: (shelfCodeRaw: string) => void;
  boundary: boolean;
  sameShelf?: boolean;
  sameSeiban: boolean;
  query?: HaizenSearch | null;
  /** 照合の列のすぐ後ろに差し込む列（納期と材料の「材料」など）。 */
  extraCell?: ReactNode;
  /** 品名を折り返し、棚と識別子の列は折り返さない。 */
  wrapName?: boolean;
};

/** 配膳の一覧表の1行。配膳の場所と納期と材料で共通。 */
export function HaizenListTableRow({ row, shelfLabel, now, onOpenShelf, boundary, sameShelf = false, sameSeiban, query = null, extraCell, wrapName = false }: Props) {
  const nowrap = wrapName ? 'whitespace-nowrap ' : '';
  return <tr onClick={row.unplaced ? undefined : () => onOpenShelf(row.shelfCodeRaw)} className={`border-inv-line ${row.unplaced ? 'text-inv-muted' : 'cursor-pointer hover:bg-inv-cyan/10'} ${boundary ? 'border-t-2' : 'border-t'} ${query ? 'bg-inv-cyan/10' : ''}`}>
    <td className="px-3.5 py-1"><span aria-label={row.verified ? '照合済み' : '未照合'} className={`flex h-7 w-7 items-center justify-center rounded border-2 text-lg font-bold ${row.verified ? 'border-inv-green bg-inv-green text-inv-green-ink' : 'border-dashed border-inv-muted'}`}>{row.verified ? '✓' : null}</span></td>
    {extraCell}
    <td className={`${nowrap}px-3.5 py-1 font-mono text-[20px] font-bold`}>
      {row.unplaced ? <span className="block h-7 w-24 rounded border-2 border-dashed border-inv-amber" /> : <button type="button" aria-label={`棚 ${row.shelfCodeRaw} ${shelfLabel}`} className={`rounded text-left focus-visible:text-inv-text ${sameShelf ? 'text-transparent' : ''}`} onClick={event => { event.stopPropagation(); onOpenShelf(row.shelfCodeRaw); }}>{shelfLabel}</button>}
    </td>
    <td className={`${wrapName ? 'min-w-[12em]' : 'whitespace-nowrap'} px-3.5 py-1 text-[22px] font-black ${query ? 'text-inv-cyan' : ''}`}>{row.fhinmei || '品名未登録'}</td>
    {([['fseiban', row.fseiban], ['fhincd', row.fhincd], ['machineName', normalizeMachineName(row.machineName)], ['order', row.manufacturingOrderBarcodeRaw], ['branch', formatHaizenBranch(row.branchNo)]] as const).map(([kind, value]) => {
      const hidden = sameSeiban && (kind === 'fseiban' || kind === 'machineName');
      return <td key={kind} className={`${nowrap}px-3.5 py-1 font-mono text-[19px] font-bold ${hidden ? 'text-transparent' : ''}`}>{query?.kind === kind && !hidden ? <mark className="rounded bg-inv-cyan px-1 text-inv-cyan-ink">{value || '—'}</mark> : value || '—'}</td>;
    })}
    <td className={`whitespace-nowrap px-3.5 py-1 font-mono text-[19px] font-bold ${sameSeiban ? 'text-transparent' : ''}`}>{row.dueDate ? <time dateTime={row.dueDate}>{row.dueDate}</time> : '—'}</td>
    <td className="whitespace-nowrap px-3.5 py-1 text-right text-sm text-inv-muted">{row.unplaced ? '—' : <><strong className="mr-2 text-xl text-inv-text">{timeSincePlaced(row.updatedAt, now)}</strong><time dateTime={row.updatedAt}>{formatHaizenPlacedAt(row.updatedAt)}</time></>}</td>
    <td className="px-3.5 py-1">{!row.unplaced && <Link className={`${invButtonGhost} h-[30px] px-3 text-[13px]`} to={`/kiosk/inventory/haizen/trail?order=${encodeURIComponent(row.manufacturingOrderBarcodeRaw)}`} onClick={event => event.stopPropagation()}><TrailIcon />足取り</Link>}</td>
  </tr>;
}
