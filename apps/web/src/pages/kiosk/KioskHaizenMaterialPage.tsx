import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useHaizenMaterialArrival, useHaizenMaterialView, useHaizenOverview, useHaizenShelves, useHaizenUnplacedParts } from '../../api/hooks/haizen-overview';
import { MaterialArrivalBadge } from '../../components/kiosk/MaterialArrivalBadge';
import { usePlanningBoardScheduleSource } from '../../features/kiosk/grindingPlanningBoard/usePlanningBoardScheduleSource';
import { buildHaizenDueGroups, buildHaizenUnplacedRows, materialArrivalKey } from '../../features/kiosk/haizen/haizenDueRows';
import { HaizenListTableRow } from '../../features/kiosk/haizen/HaizenListTableRow';
import { formatHaizenClock } from '../../features/kiosk/haizen/haizenSearch';
import { invButton, invButtonGhost, invPanel, invSeg, invSurface, invTitle } from '../../features/kiosk/inventory/inventoryUi';
import { formatDueDate } from '../../features/kiosk/productionSchedule/formatDueDate';
import { normalizeMachineName } from '../../features/kiosk/productionSchedule/machineName';

const scheduleSources = [['general', '一般'], ['dCompany', 'D社'], ['both', '両方']] as const;
const columns = ['照合', '材料', '棚', '品名', '製番', '品番', '機種名', '製造オーダー', '分配', '納期', '置いた日時', '足取り'];

function HaizenProgress({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  return <span className="min-w-0">
    <span className="flex justify-between gap-2 whitespace-nowrap"><span>{label}</span><strong>{count}/{total}</strong></span>
    <span aria-hidden="true" className="mt-1 block h-1.5 overflow-hidden rounded-full bg-inv-line2">
      <span className={`block h-full ${color}`} style={{ width: `${count / total * 100}%` }} />
    </span>
  </span>;
}

export function KioskHaizenMaterialPage() {
  const navigate = useNavigate();
  const { scheduleSource, changeScheduleSource } = usePlanningBoardScheduleSource('kiosk-haizen-material-schedule-source');
  const [openSeibans, setOpenSeibans] = useState(new Set<string | null>());
  const overview = useHaizenOverview();
  const master = useHaizenShelves();
  const unplaced = useHaizenUnplacedParts(true);
  const view = useHaizenMaterialView(scheduleSource);
  const listRows = useMemo(() => [...buildHaizenUnplacedRows(unplaced.data ?? []), ...(overview.data?.rows ?? [])], [overview.data, unplaced.data]);
  const groups = useMemo(() => buildHaizenDueGroups(listRows, view.data?.seibanOrder ?? [], view.data?.excludedFseibans ?? []), [listRows, view.data]);
  const loadingRows = overview.isPending || unplaced.isPending;
  const parts = useMemo(() => {
    if (loadingRows) return [];
    const seen = new Map<string, { fseiban: string; fhincd: string }>();
    for (const row of listRows) {
      if (row.fseiban && row.fhincd) seen.set(materialArrivalKey(row.fseiban, row.fhincd), { fseiban: row.fseiban, fhincd: row.fhincd });
    }
    return [...seen.values()];
  }, [listRows, loadingRows]);
  const material = useHaizenMaterialArrival(parts);
  const materialByPart = useMemo(() => new Map((material.data?.items ?? []).map(item => [materialArrivalKey(item.fseiban, item.fhincd), item])), [material.data]);
  const shelfLabels = useMemo(() => new Map((master.data?.shelves ?? []).map(shelf => [shelf.shelfCodeRaw, shelf.displayLabel])), [master.data]);
  const updatedAt = Math.min(overview.dataUpdatedAt || Infinity, unplaced.dataUpdatedAt || Infinity);
  const now = Date.now();
  const openShelf = (shelf: string) => navigate('/kiosk/inventory/haizen', { state: { shelf } });
  const unavailable = !overview.data || !unplaced.data || !view.data;
  const failed = overview.isError || master.isError || unplaced.isError || view.isError;
  const loading = loadingRows || view.isPending || master.isPending;
  const toggleSeiban = (fseiban: string | null) => setOpenSeibans(previous => {
    const next = new Set(previous);
    if (next.has(fseiban)) next.delete(fseiban);
    else next.add(fseiban);
    return next;
  });

  return <section className={`${invSurface} [&_button:focus-visible]:outline [&_button:focus-visible]:outline-2 [&_button:focus-visible]:outline-inv-cyan`}>
    <div className="flex shrink-0 flex-wrap items-center gap-2 whitespace-nowrap">
      <Link to="/kiosk/inventory/haizen" className={invButtonGhost}>‹ 配膳の場所へ</Link>
      <h1 className={`${invTitle} shrink-0`}>納期と材料</h1>
      <span className="min-w-0 flex-1" />
      <div role="group" aria-label="区分" className="flex gap-1">
        {scheduleSources.map(([value, label]) => <button key={value} type="button" className={invSeg(scheduleSource === value)} aria-pressed={scheduleSource === value} onClick={() => changeScheduleSource(value)}>{label}</button>)}
      </div>
      <span className="w-[76px] shrink-0 text-right text-[13px] tabular-nums text-inv-faint">{loading ? '読込中…' : Number.isFinite(updatedAt) ? `${formatHaizenClock(updatedAt)} 更新` : '—'}</span>
    </div>
    {failed && <div role="alert" className="flex items-center gap-3 text-inv-red">配膳情報を更新できません。<button type="button" className={invButton} onClick={() => { void overview.refetch(); void master.refetch(); void unplaced.refetch(); void view.refetch(); }}>再読込</button></div>}
    {material.isError && <div role="alert" className="flex items-center gap-3 text-inv-red">材料の入荷状況を取得できません。<button type="button" className={invButton} onClick={() => void material.refetch()}>再読込</button></div>}
    <div className="min-h-0 flex-1 overflow-y-auto pb-1">
      {unavailable ? <p className="py-12 text-center text-inv-muted">{loading ? '配膳情報を読み込んでいます…' : '配膳情報を取得できません'}</p> : groups.length === 0 ? <p className="py-12 text-center text-inv-muted">表示する部品がありません</p> : <div className={`${invPanel} divide-y divide-inv-line`}>
        {groups.map(({ fseiban, machineName, dueDate, rows, verified, placed }) => {
          const expanded = openSeibans.has(fseiban);
          const hasWaitingMaterial = rows.some(row => {
            const arrival = row.fseiban && row.fhincd ? materialByPart.get(materialArrivalKey(row.fseiban, row.fhincd)) : undefined;
            return arrival?.basis === 'material' && arrival.status !== 'received';
          });
          return <div key={fseiban ?? ''}>
            <button type="button" aria-expanded={expanded} onClick={() => toggleSeiban(fseiban)}
              className="grid min-h-14 w-full grid-cols-2 items-center gap-x-4 gap-y-2 rounded-lg px-4 py-2 text-left tabular-nums hover:bg-inv-cyan/10 lg:grid-cols-[minmax(0,1fr)_7rem_9rem_9rem_7rem]">
              <span className="flex min-w-0 items-baseline gap-2">
                <span aria-hidden="true" className="shrink-0 text-inv-cyan">{expanded ? '▾' : '▸'}</span>
                <strong className="shrink-0 font-mono text-xl">{fseiban || '製番不明'}</strong>
                <span className="truncate text-base text-inv-muted">{normalizeMachineName(machineName) || '—'}</span>
              </span>
              <span className="whitespace-nowrap text-base text-inv-muted">納期 <strong className="text-inv-text">{dueDate ? <time dateTime={dueDate}>{formatDueDate(dueDate) || '—'}</time> : '—'}</strong></span>
              <HaizenProgress label="照合済み" count={verified} total={rows.length} color="bg-inv-green" />
              <HaizenProgress label="配膳済み" count={placed} total={rows.length} color="bg-inv-cyan" />
              {hasWaitingMaterial && <span className="whitespace-nowrap text-sm font-bold text-inv-amber">材料未着あり</span>}
            </button>
            {expanded && <div className="overflow-x-auto">
              <table aria-label={`${fseiban || '製番不明'}の部品一覧`} className="w-full min-w-[1100px] border-collapse text-left tabular-nums">
                <thead className="bg-inv-s2 text-[15px] text-inv-muted">
                  <tr>{columns.map(label => <th key={label} scope="col" className={`whitespace-nowrap px-3.5 py-1 ${label === '置いた日時' ? 'text-right' : ''}`}>{label}</th>)}</tr>
                </thead>
                <tbody>{rows.map((row, rowIndex) => {
                  const label = shelfLabels.get(row.shelfCodeRaw) || row.shelfCodeRaw;
                  const arrival = row.fseiban && row.fhincd ? materialByPart.get(materialArrivalKey(row.fseiban, row.fhincd)) : undefined;
                  return <HaizenListTableRow key={`${row.unplaced ? 'unplaced' : row.source}:${row.id}`} row={row} shelfLabel={label} now={now} onOpenShelf={openShelf} boundary={false} sameSeiban={rowIndex > 0} wrapName
                    extraCell={<td className="px-3.5 py-1"><MaterialArrivalBadge status={arrival?.status} basis={arrival?.basis} className="px-2 py-1 text-[15px]" /></td>} />;
                })}</tbody>
              </table>
            </div>}
          </div>;
        })}
      </div>}
    </div>
  </section>;
}
