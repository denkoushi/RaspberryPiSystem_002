import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useHaizenMaterialArrival, useHaizenOverview, useHaizenShelves, useHaizenUnplacedParts } from '../../api/hooks/haizen-overview';
import { MaterialArrivalBadge } from '../../components/kiosk/MaterialArrivalBadge';
import { buildHaizenDueRows, buildHaizenUnplacedRows, materialArrivalKey } from '../../features/kiosk/haizen/haizenDueRows';
import { HaizenListTableRow } from '../../features/kiosk/haizen/HaizenListTableRow';
import { formatHaizenClock } from '../../features/kiosk/haizen/haizenSearch';
import { invButton, invButtonGhost, invPanel, invSurface, invTitle } from '../../features/kiosk/inventory/inventoryUi';

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
  const openShelf = (shelf: string) => navigate('/kiosk/inventory/haizen', { state: { shelf } });
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
            return <HaizenListTableRow key={`${row.unplaced ? 'unplaced' : row.source}:${row.id}`} row={row} shelfLabel={label} now={now} onOpenShelf={openShelf} boundary={rowIndex > 0 && !sameSeiban} sameSeiban={sameSeiban} wrapName
              extraCell={<td className="px-3.5 py-1"><MaterialArrivalBadge status={arrival?.status} basis={arrival?.basis} className="px-2 py-1 text-[15px]" /></td>} />;
          })}</tbody>
        </table>
      </div>}
    </div>
  </section>;
}
