import { useState } from 'react';
import { Link } from 'react-router-dom';

import { useHaizenShelves } from '../../api/hooks/haizen-overview';
import { useHaizenVerifyRecords } from '../../api/hooks/haizen-records';
import { timeSincePlaced } from '../../features/kiosk/haizen/haizenSearch';
import { TrailIcon } from '../../features/kiosk/inventory/InventoryIcons';
import { invButton, invButtonGhost, invCard, invPanel, invSurface, invTitle } from '../../features/kiosk/inventory/inventoryUi';
import { normalizeMachineName } from '../../features/kiosk/productionSchedule/machineName';

import type { HaizenVerifyRecord } from '../../features/kiosk/haizen/haizenRecordTypes';

const time = (value: number | string) => new Date(value).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', hour12: false });
const dateTime = (value: string) => `${new Date(value).toLocaleDateString('ja-JP', { month: '2-digit', day: '2-digit' })} ${time(value)}`;
const results = {
  match: { mark: '✓', label: '一致', color: 'text-inv-green', background: 'bg-inv-green/10' },
  mismatch: { mark: '×', label: '不一致', color: 'text-inv-red', background: 'bg-inv-red/10' },
  not_found: { mark: '?', label: '未登録', color: 'text-inv-amber', background: 'bg-inv-amber/10' },
  error: { mark: '!', label: '照合できませんでした', color: 'text-inv-muted', background: 'bg-inv-muted/10' }
};

export function KioskHaizenVerifyHistoryPage() {
  const [days, setDays] = useState<1 | 7 | 30>(7);
  const [text, setText] = useState('');
  const [result, setResult] = useState<'all' | HaizenVerifyRecord['result']>('all');
  const [device, setDevice] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const records = useHaizenVerifyRecords(days);
  const master = useHaizenShelves();
  const all = records.data?.records ?? [];
  const devices = [...new Set(all.map(record => record.deviceName))];
  const base = all.filter(record => (!device || record.deviceName === device) && [record.transfer.orderNo, record.actual.slipNo, record.transfer.fseiban, record.actual.fseiban, record.transfer.partNo, record.actual.partNo].some(value => value?.includes(text.trim())));
  const rows = base.filter(record => result === 'all' || record.result === result).sort((a, b) => b.verifiedAt.localeCompare(a.verifiedAt));
  const selected = rows.find(record => record.id === selectedId) ?? rows[0];
  const shelfLabel = (code: string) => master.data?.shelves.find(shelf => shelf.shelfCodeRaw === code)?.displayLabel || code;
  const now = Date.now();
  return <section className={`${invSurface} [&_button:focus-visible]:outline [&_button:focus-visible]:outline-2 [&_button:focus-visible]:outline-inv-cyan`}>
    <div className="flex shrink-0 flex-nowrap items-center gap-2 whitespace-nowrap">
      <Link to="/kiosk/inventory/haizen" className={invButtonGhost}>‹ 配膳の場所へ</Link>
      <h1 className={`${invTitle} shrink-0`}>照合の記録</h1>
      <span className="min-w-0 flex-1" />
      <div role="group" aria-label="期間" className="inline-flex shrink-0 overflow-hidden rounded-xl border border-inv-line2">
        {([1, 7, 30] as const).map(value => <button key={value} type="button" aria-pressed={days === value} className={`h-11 w-16 text-[15px] font-bold ${days === value ? 'bg-inv-cyan text-inv-cyan-ink' : 'bg-inv-s2 text-inv-muted'}`} onClick={() => setDays(value)}>{value === 1 ? '今日' : `${value}日`}</button>)}
      </div>
      <input aria-label="番号" placeholder="番号" value={text} maxLength={100} onChange={event => setText(event.target.value)} className={`h-11 w-[220px] shrink-0 rounded-xl border-2 bg-inv-bg px-2.5 font-mono text-2xl font-bold placeholder:text-base placeholder:text-inv-faint ${text ? 'border-inv-cyan' : 'border-inv-line2'}`} />
      <div role="group" aria-label="番号入力キー" className="flex shrink-0 flex-nowrap gap-1">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].map(key => <button key={key} type="button" className={`${invButton} w-[52px] px-0 font-mono text-[22px]`} onClick={() => setText((text + key).slice(0, 100))}>{key}</button>)}
        <button type="button" aria-label="1字消す" className={`${invButton} w-14 px-0 text-lg`} onClick={() => setText(text.slice(0, -1))}>⌫</button>
        <button type="button" aria-label="全部消す" className={`${invButton} w-14 px-0 text-lg`} onClick={() => setText('')}>C</button>
      </div>
      <span className="w-[76px] shrink-0 text-[13px] tabular-nums text-inv-faint">{records.dataUpdatedAt ? `${time(records.dataUpdatedAt)} 更新` : '読込中…'}</span>
    </div>
    <div className="flex shrink-0 flex-wrap gap-2">
      <div role="group" aria-label="結果" className="inline-flex shrink-0 overflow-hidden rounded-xl border border-inv-line2">
        {(['all', 'match', 'mismatch', 'not_found', 'error'] as const).map(value => <button key={value} type="button" aria-pressed={result === value} className={`h-11 px-4 text-[15px] font-bold ${result === value ? 'bg-inv-cyan text-inv-cyan-ink' : 'bg-inv-s2 text-inv-muted'}`} onClick={() => setResult(value)}>{value === 'all' ? '全部' : value === 'error' ? '照合できず' : results[value].label} {base.filter(record => value === 'all' || record.result === value).length}</button>)}
      </div>
      <div role="group" aria-label="端末" className="inline-flex shrink-0 overflow-hidden rounded-xl border border-inv-line2">
        {[null, ...devices].map(value => <button key={value ?? 'all'} type="button" aria-pressed={device === value} className={`h-11 px-4 text-[15px] font-bold ${device === value ? 'bg-inv-cyan text-inv-cyan-ink' : 'bg-inv-s2 text-inv-muted'}`} onClick={() => setDevice(value)}>{value ?? '全端末'}</button>)}
      </div>
    </div>
    {records.isError && <p role="alert" className="text-inv-red">照合の記録を取得できません</p>}
    <div className="grid min-h-0 flex-1 items-start gap-5 lg:grid-cols-[minmax(0,7fr)_minmax(0,4fr)]">
      <div className={`${invPanel} max-h-full overflow-x-auto overflow-y-auto`}>
        {rows.length === 0 ? <p className="py-12 text-center text-inv-muted">{records.isPending ? '読込中…' : '記録はありません'}</p> : <table aria-label="照合の記録" className="w-full border-collapse text-left tabular-nums">
          <thead className="sticky top-0 z-10 bg-inv-s2 text-[15px] text-inv-muted"><tr>{['結果', '照合した日時', '製造オーダー', '品名', '製番', '現品票', '端末', '置いた棚'].map(label => <th key={label} scope="col" className={`whitespace-nowrap px-3.5 py-3 ${label === '照合した日時' ? 'text-right' : ''}`}>{label}</th>)}</tr></thead>
          <tbody>{rows.map(record => <tr key={record.id} onClick={() => setSelectedId(record.id)} className={`cursor-pointer border-t border-inv-line hover:bg-inv-cyan/10 ${record.id === selected?.id ? 'bg-inv-cyan/10' : ''}`}>
            <td className="px-3.5 py-3"><button type="button" aria-label={`${results[record.result].label} ${record.transfer.orderNo}`} onClick={() => setSelectedId(record.id)} className={`flex h-9 w-9 items-center justify-center rounded-full text-xl font-bold ${results[record.result].color} ${results[record.result].background}`}>{results[record.result].mark}</button></td>
            <td className="whitespace-nowrap px-3.5 py-3 text-right text-sm text-inv-muted"><strong className="text-2xl text-inv-text">{timeSincePlaced(record.verifiedAt, now)}</strong><br /><time dateTime={record.verifiedAt}>{dateTime(record.verifiedAt)}</time></td>
            <td className="px-3.5 py-3 font-mono text-[19px] font-bold">{record.transfer.orderNo}</td>
            <td className="px-3.5 py-3 text-[22px] font-black">{record.fhinmei || '—'}</td>
            <td className="px-3.5 py-3 font-mono text-[19px] font-bold">{record.transfer.fseiban || '—'}</td>
            <td className="px-3.5 py-3 font-mono text-[19px] font-bold">{record.actual.slipNo || '—'}</td>
            <td className="px-3.5 py-3 text-sm text-inv-muted">{record.deviceName}</td>
            <td className="px-3.5 py-3 font-mono text-[19px] font-bold text-inv-amber">{record.placedShelfCodeRaw ? <>{shelfLabel(record.placedShelfCodeRaw)}<div className="text-sm">分配{record.branchNo === 0 ? 'なし' : record.branchNo ?? '—'}</div></> : '—'}</td>
          </tr>)}</tbody>
        </table>}
      </div>
      {selected && <div className={`${invPanel} flex min-w-0 flex-col gap-4 p-4 lg:sticky lg:top-0`}>
        <div className="flex items-center gap-3">
          <span className={`flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full text-[28px] font-bold ${results[selected.result].color} ${results[selected.result].background}`}>{results[selected.result].mark}</span>
          <div><h2 className={`text-2xl font-black ${results[selected.result].color}`}>{results[selected.result].label}</h2><p className="text-sm text-inv-muted">{dateTime(selected.verifiedAt)} ・ {selected.deviceName}</p></div>
        </div>
        {selected.reason && <p className={`text-xl font-bold ${results[selected.result].color}`}>{selected.reason}</p>}
        {(selected.fhinmei || selected.machineName) && <h3 className="text-[22px] font-black">{selected.fhinmei} <span className="font-mono text-xl text-inv-muted">{normalizeMachineName(selected.machineName)}</span></h3>}
        <div className="grid grid-cols-2 gap-3">
          {(['transfer', 'actual'] as const).map(kind => <section key={kind} className={`${invCard} min-w-0 border-t-2 bg-inv-s2 px-4 py-3 ${kind === 'transfer' ? 'border-t-inv-cyan' : 'border-t-inv-violet'}`}>
            <h3 className="text-sm text-inv-muted">{kind === 'transfer' ? '移動票' : '現品票'}</h3>
            <p className="break-all font-mono text-2xl font-bold">{kind === 'transfer' ? selected.transfer.orderNo : selected.actual.slipNo || '—'}</p>
            <dl className="flex flex-wrap gap-x-5 gap-y-2">
              {(['partNo', 'fseiban'] as const).map(field => <div key={field}><dt className="text-sm text-inv-muted">{field === 'partNo' ? '品番' : '製番'}</dt><dd className={`break-all font-mono text-lg font-bold ${selected.mismatch === (field === 'partNo' ? 'part' : 'fseiban') ? 'text-inv-red' : ''}`}>{selected[kind][field] || '—'}</dd></div>)}
            </dl>
          </section>)}
        </div>
        {selected.placedShelfCodeRaw && <div className={`${invCard} bg-inv-s2 px-4 py-3`}><dl className="flex flex-wrap gap-x-5 gap-y-2"><div className="flex items-baseline gap-2"><dt className="text-sm text-inv-muted">置いた棚</dt><dd className="font-mono text-lg font-bold text-inv-amber">{shelfLabel(selected.placedShelfCodeRaw)}</dd></div><div className="flex items-baseline gap-2"><dt className="text-sm text-inv-muted">分配</dt><dd className="font-mono text-lg font-bold">{selected.branchNo === 0 ? 'なし' : selected.branchNo ?? '—'}</dd></div></dl></div>}
        <Link className={invButton} to={`/kiosk/inventory/haizen/trail?order=${encodeURIComponent(selected.transfer.orderNo)}`}><TrailIcon />足取り</Link>
      </div>}
    </div>
  </section>;
}
