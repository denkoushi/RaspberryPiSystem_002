import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { useHaizenShelves } from '../../api/hooks/haizen-overview';
import { useHaizenOrderTrail } from '../../api/hooks/haizen-records';
import { invButton, invButtonGhost, invPanel, invSurface, invTitle } from '../../features/kiosk/inventory/inventoryUi';
import { normalizeMachineName } from '../../features/kiosk/productionSchedule/machineName';

import type { HaizenOrderTrail } from '../../features/kiosk/haizen/haizenRecordTypes';

const time = (value: number | string) => new Date(value).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', hour12: false });
const sourceColors = { 棚: 'bg-inv-amber', 照合: 'bg-inv-violet', 工程: 'bg-inv-cyan', パレット: 'bg-inv-rose', Zero2W: 'bg-inv-green', 購買: 'bg-inv-muted' };
const tones = { done: 'border-inv-green text-inv-green', active: 'border-inv-cyan text-inv-cyan', waiting: 'border-inv-amber text-inv-amber', none: 'border-inv-faint text-inv-faint' };

export function KioskHaizenTrailPage() {
  const [params, setParams] = useSearchParams();
  const text = params.get('order') ?? '';
  const [step, setStep] = useState<string | null>(null);
  const [source, setSource] = useState<'全部' | HaizenOrderTrail['events'][number]['source']>('全部');
  const setText = (value: string) => { setParams(current => { current.set('order', value); return current; }, { replace: true }); setStep(null); };
  const records = useHaizenOrderTrail(text);
  const master = useHaizenShelves();
  const trail = records.data?.trail;
  const stepEvents = trail?.events.filter(event => !step || event.processOrder === step || event.source === '購買') ?? [];
  const events = stepEvents.filter(event => source === '全部' || event.source === source).sort((a, b) => b.date.localeCompare(a.date) || (b.at ?? '').localeCompare(a.at ?? ''));
  const days = [...new Set(events.map(event => event.date))];
  return <section className={`${invSurface} [&_button:focus-visible]:outline [&_button:focus-visible]:outline-2 [&_button:focus-visible]:outline-inv-cyan`}>
    <div className="flex shrink-0 flex-nowrap items-center gap-2 whitespace-nowrap">
      <Link to="/kiosk/inventory/haizen" className={invButtonGhost}>‹ 配膳の場所へ</Link>
      <h1 className={`${invTitle} shrink-0`}>足取り</h1>
      <span className="min-w-0 flex-1" />
      <input aria-label="製造オーダー" placeholder="製造オーダー" value={text} maxLength={100} onChange={event => setText(event.target.value)} className={`h-11 w-[220px] shrink-0 rounded-xl border-2 bg-inv-bg px-2.5 font-mono text-2xl font-bold placeholder:text-base placeholder:text-inv-faint ${text ? 'border-inv-cyan' : 'border-inv-line2'}`} />
      <div role="group" aria-label="番号入力キー" className="flex shrink-0 flex-nowrap gap-1">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].map(key => <button key={key} type="button" className={`${invButton} w-[52px] px-0 font-mono text-[22px]`} onClick={() => setText((text + key).slice(0, 100))}>{key}</button>)}
        <button type="button" aria-label="1字消す" className={`${invButton} w-14 px-0 text-lg`} onClick={() => setText(text.slice(0, -1))}>⌫</button>
        <button type="button" aria-label="全部消す" className={`${invButton} w-14 px-0 text-lg`} onClick={() => setText('')}>C</button>
      </div>
      <span className="w-[76px] shrink-0 text-[13px] tabular-nums text-inv-faint">{records.dataUpdatedAt ? `${time(records.dataUpdatedAt)} 更新` : '読込中…'}</span>
    </div>
    {/^\d{10}$/.test(text) && (records.isError ? <p role="alert" className="py-12 text-center text-inv-muted">足取りを取得できません</p> : records.isPending ? <p className="py-12 text-center text-inv-muted">読込中…</p> : !trail ? <p className="py-12 text-center text-inv-muted">一致する品物はありません</p> : <div className="grid min-h-0 flex-1 items-start gap-5 overflow-y-auto lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)]">
      <div className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-0">
        <div className={`${invPanel} flex flex-col gap-3 p-5`}>
          <div><p className="text-sm text-inv-muted">製造オーダー</p><p className="font-mono text-3xl font-black">{trail.orderNo}</p></div>
          <h2 className="text-3xl font-black">{trail.fhinmei} <span className="font-mono text-xl text-inv-muted">{normalizeMachineName(trail.machineName)}</span></h2>
          <dl className="flex flex-wrap gap-x-5 gap-y-2">{[['製番', trail.fseiban], ['品番', trail.fhincd]].map(([label, value]) => <div key={label} className="flex items-baseline gap-2"><dt className="text-sm text-inv-muted">{label}</dt><dd className="break-all font-mono text-lg font-bold">{value}</dd></div>)}</dl>
          <div className="flex flex-wrap gap-2">{trail.currentShelves.map(shelf => <Link key={`${shelf.shelfCodeRaw}:${shelf.branchNo}`} className={`${invButtonGhost} border-inv-amber text-inv-amber`} to="/kiosk/inventory/haizen" state={{ shelf: shelf.shelfCodeRaw }}>{master.data?.shelves.find(entry => entry.shelfCodeRaw === shelf.shelfCodeRaw)?.displayLabel || shelf.shelfCodeRaw} 分配{shelf.branchNo === 0 ? 'なし' : shelf.branchNo ?? '—'}</Link>)}</div>
        </div>
        <div className={`${invPanel} flex flex-col gap-2 p-3`}>
          {trail.steps.map(item => <button key={item.processOrder} type="button" aria-pressed={step === item.processOrder} onClick={() => setStep(step === item.processOrder ? null : item.processOrder)} className={`rounded-[10px] border-l-4 px-4 py-3 text-left ${tones[item.tone]} ${step === item.processOrder ? 'bg-inv-cyan/10' : 'bg-inv-s2'}`}>
            <div className="text-sm text-inv-muted">工順 {item.processOrder}</div><div className="text-xl font-black text-inv-text">{item.resourceName}</div><div className="text-sm">{item.status}</div>
          </button>)}
        </div>
      </div>
      <div className={`${invPanel} min-w-0 p-4`}>
        <div role="group" aria-label="記録元" className="inline-flex shrink-0 overflow-hidden rounded-xl border border-inv-line2">
          {(['全部', ...Object.keys(sourceColors)] as Array<typeof source>).map(value => <button key={value} type="button" aria-pressed={source === value} className={`h-11 px-4 text-[15px] font-bold ${source === value ? 'bg-inv-cyan text-inv-cyan-ink' : 'bg-inv-s2 text-inv-muted'}`} onClick={() => setSource(value)}>{value} {stepEvents.filter(event => value === '全部' || event.source === value).length}</button>)}
        </div>
        {events.length === 0 && <p className="py-12 text-center text-inv-muted">記録はありません</p>}
        {days.map(day => <div key={day}>
          <h3 className="sticky top-0 z-10 bg-inv-s1 py-3 text-sm font-bold text-inv-muted">{new Date(`${day}T00:00:00`).toLocaleDateString('ja-JP', { month: '2-digit', day: '2-digit' })}</h3>
          {events.filter(event => event.date === day).map(event => <div key={event.id} className={`grid grid-cols-[64px_16px_1fr] items-start gap-3 px-3 py-3 ${event.loose ? 'rounded-[10px] border border-dashed border-inv-line2' : ''}`}>
            <time dateTime={event.at ?? event.date} className="font-mono tabular-nums text-inv-muted">{event.at ? time(event.at) : '—'}</time>
            <span className={`mt-1.5 h-3 w-3 rounded-full ${sourceColors[event.source]}`} />
            <div><div className="text-xl font-bold">{event.title}</div><div className="text-sm text-inv-muted">{[event.source, event.processOrder ? `工順 ${event.processOrder}` : null, event.detail].filter(Boolean).join(' ・ ')}</div></div>
          </div>)}
        </div>)}
      </div>
    </div>)}
  </section>;
}
