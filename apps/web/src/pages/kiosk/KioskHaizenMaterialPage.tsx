import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useHaizenMaterialArrival, useHaizenOverview, useHaizenShelves, useHaizenUnplacedParts } from '../../api/hooks/haizen-overview';
import { MaterialArrivalBadge } from '../../components/kiosk/MaterialArrivalBadge';
import { buildHaizenDueRows, buildHaizenUnplacedRows, materialArrivalKey } from '../../features/kiosk/haizen/haizenDueRows';
import { formatHaizenClock, formatHaizenPlacedAt, timeSincePlaced } from '../../features/kiosk/haizen/haizenSearch';
import { TrailIcon } from '../../features/kiosk/inventory/InventoryIcons';
import { invButton, invButtonGhost, invPanel, invSurface, invTitle } from '../../features/kiosk/inventory/inventoryUi';
import { normalizeMachineName } from '../../features/kiosk/productionSchedule/machineName';

import type { HaizenOverviewRow } from '../../api/domains/mobile-placement';

const emptyRows: HaizenOverviewRow[] = [];
const columns = ['照合', '材料', '棚', '品名', '製番', '品番', '機種名', '製造オーダー', '分配', '納期', '置いた日時', '足取り'];

export function KioskHaizenMaterialPage() {
  const navigate = useNavigate();
  const overview = useHaizenOverview();
  const master = useHaizenShelves();
  const unplaced = useHaizenUnplacedParts(true);
  const rows = overview.data?.rows ?? emptyRows;
  const listRows = useMemo(() => buildHaizenDueRows(rows, buildHaizenUnplacedRows(unplaced.data ?? [])), [rows, unplaced.data]);
  const parts = useMemo(() => {
    const seen = new Map<string, { fseiban: string; fhincd: string }>();
    for (const row of listRows) if (row.fseiban && row.fhincd) seen.set(materialArrivalKey(row.fseiban, row.fhincd), { fseiban: row.fseiban, fhincd: row.fhincd });
    return [...seen.values()];
  }, [listRows]);
  const material = useHaizenMaterialArrival(parts);
  const materialByPart = useMemo(() => new Map((material.data?.items ?? []).map(item => [materialArrivalKey(item.fseiban, item.fhincd), item])), [material.data]);
  const shelfLabels = useMemo(() => new Map((master.data?.shelves ?? []).map(shelf => [shelf.shelfCodeRaw, shelf.displayLabel])), [master.data]);
  const updatedAt = Math.min(overview.dataUpdatedAt, master.dataUpdatedAt);
  const now = Date.now();
  const unavailable = !overview.data || !master.data || (!unplaced.data && !unplaced.isError);
  const failed = overview.isError || master.isError || unplaced.isError;
  return <section className={`${invSurface} [&_button:focus-visible]:outline [&_button:focus-visible]:outline-2 [&_button:focus-visible]:outline-inv-cyan`}>
    <div className="flex shrink-0 flex-nowrap items-center gap-2 whitespace-nowrap">
      <Link to="/kiosk/inventory/haizen" className={invButtonGhost}>‹ 配膳の場所へ</Link>
      <h1 className={`${invTitle} shrink-0`}>納期と材料</h1>
      <span className="min-w-0 flex-1" />
      <span className="w-[76px] shrink-0 text-[13px] tabular-nums text-inv-faint">{updatedAt ? `${formatHaizenClock(updatedAt)} 更新` : '読込中…'}</span>
    </div>
    {failed && <div role="alert" className="flex items-center gap-3 text-inv-red">配膳情報を更新できません。{!unavailable && '前回取得した情報を表示しています。'}<button type="button" className={invButton} onClick={() => { void overview.refetch(); void master.refetch(); void unplaced.refetch(); }}>再読込</button></div>}
    {material.isError && <div role="alert" className="flex items-center gap-3 text-inv-red">材料の入荷状況を取得できません。<button type="button" className={invButton} onClick={() => void material.refetch()}>再読込</button></div>}
    <div className="min-h-0 flex-1 overflow-y-auto pb-1">
      {unavailable ? <p className="py-12 text-center text-inv-muted">{failed ? '配膳情報を取得できません' : '配膳情報を読み込んでいます…'}</p> : listRows.length === 0 ? <p className="py-12 text-center text-inv-muted">どの棚にも何も置かれていません</p> : <div className={`${invPanel} max-h-full overflow-x-auto`}>
        <table aria-label="納期と材料の一覧" className="w-full min-w-[1100px] border-collapse text-left tabular-nums">
          <thead className="sticky top-0 z-10 bg-inv-s2 text-[15px] text-inv-muted">
            <tr>{columns.map(label => <th key={label} scope="col" className={`whitespace-nowrap px-3.5 py-1 ${label === '置いた日時' ? 'text-right' : ''}`}>{label}</th>)}</tr>
          </thead>
          <tbody>{listRows.map((row, rowIndex) => {
            const label = shelfLabels.get(row.shelfCodeRaw) || row.shelfCodeRaw;
            const sameSeiban = rowIndex > 0 && listRows[rowIndex - 1].fseiban === row.fseiban;
            const arrival = row.fseiban && row.fhincd ? materialByPart.get(materialArrivalKey(row.fseiban, row.fhincd)) : undefined;
            const open = row.unplaced ? undefined : () => navigate('/kiosk/inventory/haizen', { state: { shelf: row.shelfCodeRaw } });
            return <tr key={`${row.unplaced ? 'unplaced' : row.source}:${row.id}`} onClick={open} className={`border-inv-line ${row.unplaced ? 'text-inv-muted' : 'cursor-pointer hover:bg-inv-cyan/10'} ${rowIndex > 0 && !sameSeiban ? 'border-t-2' : 'border-t'}`}>
              <td className="px-3.5 py-1"><span aria-label={row.verified ? '照合済み' : '未照合'} className={`flex h-7 w-7 items-center justify-center rounded border-2 text-lg font-bold ${row.verified ? 'border-inv-green bg-inv-green text-inv-green-ink' : 'border-dashed border-inv-muted'}`}>{row.verified ? '✓' : null}</span></td>
              <td className="px-3.5 py-1"><MaterialArrivalBadge status={arrival?.status} basis={arrival?.basis} className="px-2 py-1 text-[15px]" /></td>
              <td className="whitespace-nowrap px-3.5 py-1 font-mono text-[20px] font-bold">
                {row.unplaced ? <span className="block h-7 w-24 rounded border-2 border-dashed border-inv-amber" /> : label}
              </td>
              <td className="min-w-[12em] px-3.5 py-1 text-[22px] font-black">{row.fhinmei || '品名未登録'}</td>
              {([['fseiban', row.fseiban], ['fhincd', row.fhincd], ['machineName', normalizeMachineName(row.machineName)], ['order', row.manufacturingOrderBarcodeRaw], ['branch', row.branchNo === null ? '—' : row.branchNo === 0 ? 'なし' : String(row.branchNo)]] as const).map(([kind, value]) => <td key={kind} className={`whitespace-nowrap px-3.5 py-1 font-mono text-[19px] font-bold ${sameSeiban && (kind === 'fseiban' || kind === 'machineName') ? 'text-transparent' : ''}`}>{value || '—'}</td>)}
              <td className={`whitespace-nowrap px-3.5 py-1 font-mono text-[19px] font-bold ${sameSeiban ? 'text-transparent' : ''}`}>{row.dueDate ? <time dateTime={row.dueDate}>{row.dueDate}</time> : '—'}</td>
              <td className="whitespace-nowrap px-3.5 py-1 text-right text-sm text-inv-muted">{row.unplaced ? '—' : <><strong className="mr-2 text-xl text-inv-text">{timeSincePlaced(row.updatedAt, now)}</strong><time dateTime={row.updatedAt}>{formatHaizenPlacedAt(row.updatedAt)}</time></>}</td>
              <td className="px-3.5 py-1">{!row.unplaced && <Link className={`${invButtonGhost} h-[30px] px-3 text-[13px]`} to={`/kiosk/inventory/haizen/trail?order=${encodeURIComponent(row.manufacturingOrderBarcodeRaw)}`} onClick={event => event.stopPropagation()}><TrailIcon />足取り</Link>}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>}
    </div>
  </section>;
}
