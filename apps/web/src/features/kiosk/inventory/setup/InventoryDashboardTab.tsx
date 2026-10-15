import { formatInventoryLabelNumber, normalizeToolValue, type InventoryDashboard, type InventoryVariantGroup } from '@raspi-system/shared-types';
import { useEffect, useRef, useState } from 'react';

import { useInventoryDashboard, useInventoryMutations, useInventoryValueVariants } from '../../../../api/hooks';
import { invButtonGhost, invButtonPrimary, invField, invPanel, invSeg } from '../inventoryUi';

import { setupErrorText } from './setupError';

const number = (value: number) => value.toLocaleString('ja-JP');
const normalized = (value: string | null) => normalizeToolValue(value ?? '') || '(未入力)';
const difference = (value: number, previous: number) => previous === 0 ? (value === 0 ? '±0%' : '比較なし') : `${value >= previous ? '+' : ''}${Math.round((value - previous) / previous * 100)}%`;
const dateLabel = (value: string) => `${Number(value.slice(5, 7))}/${Number(value.slice(8, 10))}`;
const panel = `${invPanel} flex min-h-0 min-w-0 flex-col overflow-hidden p-4`;
const heading = 'mb-2 flex shrink-0 items-center justify-between gap-2';

function Columns({ values, labels, tooltips, label, compact = false }: { values: number[]; labels: string[]; tooltips: string[]; label: string; compact?: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  // Draw at the frame's real pixel size so labels are never stretched.
  const frame = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: compact ? 360 : 900, height: 230 });
  useEffect(() => {
    const element = frame.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setSize({ width: Math.round(width), height: Math.round(height) });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const { width, height } = size;
  const left = compact ? 50 : 44;
  const bottom = height - 28;
  const top = 10;
  const step = (width - left - 8) / Math.max(values.length, 1);
  const max = Math.max(1, ...values);
  const ceiling = Math.ceil(max / (max > 100 ? 100 : max > 10 ? 10 : 1)) * (max > 100 ? 100 : max > 10 ? 10 : 1);
  const every = values.length <= 12 ? 1 : values.length <= 26 ? 4 : 8;
  return <div ref={frame} className="relative min-h-0 flex-1" onMouseLeave={() => setHover(null)}>
    <svg role="img" aria-label={label} viewBox={`0 0 ${width} ${height}`} className="absolute inset-0 h-full w-full">
      {[0, 1, 2, 3, 4].map(tick => {
        const y = bottom - (bottom - top) * tick / 4;
        return <g key={tick}><line x1={left} x2={width - 8} y1={y} y2={y} stroke="#263145" /><text x={left - 6} y={y + 4} textAnchor="end" fill="#76839a" fontSize="12">{number(Math.round(ceiling * tick / 4))}</text></g>;
      })}
      {values.map((value, i) => {
        const gap = Math.min(10, step * .3);
        const x = left + i * step + gap / 2;
        const barWidth = step - gap;
        const barHeight = (bottom - top) * value / ceiling;
        const y = bottom - barHeight;
        const r = Math.min(4, barHeight, barWidth / 2);
        return <g key={i}>
          <path d={`M${x},${bottom}V${y + r}q0,-${r} ${r},-${r}H${x + barWidth - r}q${r},0 ${r},${r}V${bottom}Z`} fill={i === values.length - 1 ? '#39d0f0' : '#2a8fa8'} />
          <rect x={left + i * step} y={top} width={step} height={bottom - top} fill="transparent" onMouseEnter={() => setHover(i)}><title>{tooltips[i]}</title></rect>
          {(i % every === 0 || i === values.length - 1) && <text x={x + barWidth / 2} y={height - 8} textAnchor="middle" fill="#76839a" fontSize="12">{labels[i]}</text>}
        </g>;
      })}
    </svg>
    {hover !== null && hover < values.length && <div role="tooltip" className="pointer-events-none absolute top-0 rounded-lg border border-inv-line2 bg-inv-s3 px-3 py-2 text-sm shadow-lg" style={{ left: `${Math.min(65, hover / values.length * 80)}%` }}>{tooltips[hover]}</div>}
  </div>;
}

function Sparkline({ weekly }: { weekly: number[] }) {
  // Show twelve equal portions of the selected period, including zero-usage weeks.
  const points = Array.from({ length: Math.min(12, weekly.length) }, (_, index) => {
    const count = Math.min(12, weekly.length);
    return weekly.slice(Math.floor(index * weekly.length / count), Math.floor((index + 1) * weekly.length / count)).reduce((sum, value) => sum + value, 0);
  });
  const max = Math.max(1, ...points);
  return <svg width="90" height="24" viewBox="0 0 90 24" aria-label="持出の推移" role="img"><polyline points={points.map((value, i) => `${i * 90 / Math.max(1, points.length - 1)},${22 - value / max * 20}`).join(' ')} fill="none" stroke="#39d0f0" strokeWidth="2" /></svg>;
}

function breakdown(items: InventoryDashboard['items'], dimension: 'toolName' | 'maker') {
  const map = new Map<string, { name: string; issued: number; raw: Set<string>; other: boolean }>();
  for (const item of items.filter(item => item.issued > 0)) {
    const name = normalized(item[dimension]);
    const row = map.get(name) ?? { name, issued: 0, raw: new Set<string>(), other: false };
    row.issued += item.issued;
    row.raw.add(item[dimension] ?? '');
    map.set(name, row);
  }
  const rows = [...map.values()].sort((a, b) => b.issued - a.issued);
  return rows.length <= 7 ? rows : [...rows.slice(0, 7), { name: 'その他', issued: rows.slice(7).reduce((sum, row) => sum + row.issued, 0), raw: new Set<string>(), other: true }];
}

export function InventoryDashboardTab({ accessPassword, onEditItems }: { accessPassword: string; onEditItems: () => void }) {
  const [weeks, setWeeks] = useState(12);
  const [machine, setMachine] = useState('');
  const [dimension, setDimension] = useState<'toolName' | 'maker'>('toolName');
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const query = useInventoryDashboard(weeks, machine || undefined, accessPassword);
  const variants = useInventoryValueVariants(accessPassword);
  const mutations = useInventoryMutations(accessPassword, true);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(null), 2500); return () => clearTimeout(timer); }, [toast]);
  const act = async (group: InventoryVariantGroup, merge: boolean) => {
    setError(null);
    try {
      if (merge) await mutations.mergeValueVariants.mutateAsync({ field: group.field, to: group.to, from: group.from.map(row => row.value) });
      else await mutations.dismissValueVariants.mutateAsync({ field: group.field, values: [group.to, ...group.from.map(row => row.value)] });
      setToast(merge ? '表記をまとめました' : '別のものとして残しました');
    } catch (caught) { setError(setupErrorText(caught)); }
  };
  const data = query.data;
  const used = data?.items.filter(item => item.issued > 0) ?? [];
  const rows = breakdown(data?.items ?? [], dimension);
  const max = Math.max(1, ...rows.map(row => row.issued));
  const pending = mutations.mergeValueVariants.isPending || mutations.dismissValueVariants.isPending;
  const groups = variants.data?.groups.filter(group => !group.auto) ?? [];
  const fieldLabels = { maker: 'メーカー', toolName: '種類', model: '型式', toolSize: 'サイズ', workMaterial: '加工材', usage: '用途' };
  return <div className="relative flex min-h-0 flex-1 flex-col gap-3 pt-3">
    <div className="flex shrink-0 items-center gap-3">
      <span className="text-sm text-inv-muted">期間</span>
      <div role="group" aria-label="期間" className="flex gap-1">{([[4, '4週'], [12, '12週'], [26, '半年'], [52, '1年']] as const).map(([value, label]) => <button key={value} type="button" className={invSeg(weeks === value)} aria-pressed={weeks === value} onClick={() => setWeeks(value)}>{label}</button>)}</div>
      <label htmlFor="dashboard-machine" className="ml-3 text-sm text-inv-muted">場所</label>
      <select id="dashboard-machine" className={`${invField} min-h-11 max-w-[360px]`} value={machine} onChange={event => setMachine(event.target.value)}><option value="">すべての加工機</option>{data?.machines.map(value => <option key={value}>{value}</option>)}</select>
      <span className="ml-auto flex items-center gap-2 text-sm text-inv-muted"><i className="h-2 w-2 rounded-full bg-inv-green" />表記をそろえて集計中</span>
    </div>
    {query.isLoading ? <p role="status">読み込み中…</p> : query.error ? <p role="alert">{setupErrorText(query.error)}</p> : data ? <div className="grid min-h-0 flex-1 grid-cols-12 grid-rows-[120px_minmax(0,1fr)_minmax(0,1.15fr)] gap-3">
      {[
        { label: '持出', value: `${number(data.totalIssued)} 本`, sub: `前の${weeks}週より ${difference(data.totalIssued, data.previousTotalIssued)}` },
        { label: '使った種類', value: `${new Set(used.map(item => normalized(item.toolName))).size} 種類`, sub: `入力のままだと ${new Set(used.map(item => item.toolName ?? '')).size}種類` },
        { label: '在庫が少ない', value: `${data.lowStockCount} 件`, sub: '▲ 残り2本以下', warn: true },
        { label: '金額', value: data.pricedItemCount ? `¥${number(data.cost.total)}` : '—', sub: data.pricedItemCount ? `前の期間より ${difference(data.cost.total, data.cost.previousTotal)}` : '単価の登録後に出ます' },
      ].map(tile => <section aria-label={tile.label} key={tile.label} className={`${panel} col-span-3 justify-center gap-1 ${tile.warn ? 'border-inv-amber/45' : ''}`}><span className="text-sm text-inv-muted">{tile.label}</span><strong className="text-[36px] font-black leading-none tabular-nums">{tile.value}</strong><span className={`text-sm ${tile.warn ? 'text-inv-amber' : 'text-inv-muted'}`}>{tile.sub}</span></section>)}
      <section aria-label="週ごとの持出" className={`${panel} col-span-7`}><div className={heading}><h2 className="text-lg font-black">週ごとの持出</h2><span className="text-sm text-inv-muted">1週の平均 {number(Math.round(data.totalIssued / weeks))}本</span></div><Columns label="週ごとの持出グラフ" values={data.weeks.map(row => row.issued)} labels={data.weeks.map(row => dateLabel(row.weekStart))} tooltips={data.weeks.map(row => `${dateLabel(row.weekStart)} の週  ${number(row.issued)} 本`)} /></section>
      <section aria-label="種類別の持出" className={`${panel} col-span-5`}><div className={heading}><h2 className="text-lg font-black">{dimension === 'toolName' ? '種類別の持出' : 'メーカー別の持出'}</h2><div className="flex gap-1">{(['toolName', 'maker'] as const).map(value => <button key={value} className={invSeg(dimension === value)} aria-pressed={dimension === value} onClick={() => setDimension(value)}>{value === 'toolName' ? '工具の種類' : 'メーカー'}</button>)}</div></div>
        <div className="flex min-h-0 flex-1 flex-col justify-around gap-1">{rows.map(row => <div key={row.other ? '__other' : row.name} title={[...row.raw].join(' / ')} className="grid grid-cols-[minmax(100px,1fr)_minmax(0,1.4fr)_60px] items-center gap-2 text-sm"><span className="truncate">{row.name}{row.raw.size > 1 && <small className="ml-2 text-inv-amber">{row.raw.size}表記</small>}</span><span className="h-[18px]"><i className={`block h-full rounded-r ${row.other ? 'bg-inv-faint' : 'bg-inv-cyan'}`} style={{ width: `${row.issued / max * 100}%` }} /></span><span className="text-right tabular-nums">{number(row.issued)} 本</span></div>)}{!rows.length && <p className="text-inv-faint">持出はありません</p>}</div>
      </section>
      <section aria-label="よく使う工具" className={`${panel} col-span-5`}><div className={heading}><h2 className="text-lg font-black">よく使う工具</h2><small className="text-inv-faint">上位7件</small></div><table className="w-full table-fixed text-sm"><thead className="border-b border-inv-line text-left text-xs text-inv-faint"><tr><th className="w-[39%] pb-2">アイテム</th><th className="w-[20%]">種類</th><th className="w-[10%] text-right">持出</th><th className="w-[20%] pl-2">動き</th><th className="text-right">在庫</th></tr></thead><tbody>{[...used].sort((a, b) => b.issued - a.issued).slice(0, 7).map(item => <tr key={item.id} className="h-[36px] border-b border-inv-line/60"><td className="truncate" title={item.name}><span className="mr-2 rounded border border-dashed border-inv-amber/50 px-1 font-mono text-xs text-inv-amber" title={item.labelNumbers.map(formatInventoryLabelNumber).join(' / ')}>{item.labelNumbers.length ? formatInventoryLabelNumber(item.labelNumbers[0]) : '—'}</span>{item.name}</td><td className="truncate" title={normalized(item.toolName)}>{normalized(item.toolName)}</td><td className="text-right tabular-nums">{number(item.issued)}</td><td className="pl-2"><Sparkline weekly={item.weekly} /></td><td className={`text-right tabular-nums ${item.stock <= 2 ? 'font-bold text-inv-amber' : ''}`}>{item.stock <= 2 ? '▲ ' : ''}{item.stock}</td></tr>)}</tbody></table></section>
      <section aria-label="金額の推移" className={`${panel} col-span-3 ${data.pricedItemCount ? '' : 'border-dashed border-inv-line2'}`}><div className={heading}><h2 className="text-lg font-black">金額</h2><small className="text-inv-faint">現在の単価</small></div>
        {data.pricedItemCount ? <Columns compact label="月ごとの金額グラフ" values={data.cost.byMonth.map(row => row.amount)} labels={data.cost.byMonth.map(row => `${Number(row.month.slice(5))}月`)} tooltips={data.cost.byMonth.map(row => `${row.month}  ¥${number(row.amount)}`)} /> : <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg bg-inv-s2/30 text-sm text-inv-faint">単価の登録後に出ます</div>}
        <div className="mt-3 h-2 shrink-0 overflow-hidden rounded bg-inv-s3" role="meter" aria-label="単価の登録率" aria-valuenow={data.pricedItemCount} aria-valuemin={0} aria-valuemax={Math.max(1, data.itemCount)}><div className="h-full bg-inv-cyan" style={{ width: `${data.itemCount ? data.pricedItemCount / data.itemCount * 100 : 0}%` }} /></div><p className="my-2 text-sm text-inv-muted">単価が入っているアイテム <b className="text-inv-text">{data.pricedItemCount} / {data.itemCount}</b></p><button className={invButtonGhost} onClick={onEditItems}>単価を入れる</button>
      </section>
      <section aria-label="表記ゆれ" className={`${panel} col-span-4`}><div className={heading}><h2 className="text-lg font-black">表記ゆれ</h2><small className="text-inv-faint">確認 {groups.length}件</small></div>
        <p className="mb-2 shrink-0 rounded-lg bg-inv-s2 px-3 py-2 text-sm text-inv-muted"><span className="mr-2 text-inv-green">✓</span>全角・半角、大文字・小文字、空白は自動でそろえ済み {variants.data?.autoMergedValueCount ?? 0}件</p>
        {error || variants.error ? <p role="alert" className="mb-2 text-sm text-inv-red">{error ?? setupErrorText(variants.error)}</p> : null}
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">{variants.isLoading ? <p>読み込み中…</p> : groups.map(group => <div key={`${group.field}:${group.to}`} className="shrink-0 rounded-xl border border-inv-line2 bg-inv-bg p-3"><div className="mb-2 flex flex-wrap items-center gap-1.5 text-sm"><span className="mr-1 text-xs text-inv-faint">{fieldLabels[group.field]}</span>{group.from.map(row => <span className="rounded-lg border border-inv-line2 bg-inv-s2 px-2 py-1" key={row.value}>{row.value} <small className="text-inv-faint">{row.count}件</small></span>)}<span className="text-inv-faint">→</span><span className="rounded-lg border-2 border-inv-cyan bg-inv-cyan/10 px-2 py-1 font-bold">{group.to}</span></div><div className="flex gap-2"><button className={`${invButtonPrimary} min-w-0 flex-1`} disabled={pending} onClick={() => void act(group, true)}><span className="truncate">{group.to} にまとめる</span></button><button className={invButtonGhost} disabled={pending} onClick={() => void act(group, false)}>別のもの</button></div></div>)}{!variants.isLoading && !variants.error && !groups.length && <p className="m-auto text-sm text-inv-faint">確認するものはありません</p>}</div>
      </section>
    </div> : null}
    {toast && <div role="status" className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-xl border border-inv-green bg-inv-s3 px-5 py-3 shadow-lg">{toast}</div>}
  </div>;
}
