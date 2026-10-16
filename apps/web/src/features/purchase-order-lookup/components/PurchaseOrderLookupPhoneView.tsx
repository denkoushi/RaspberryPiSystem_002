import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { HaizenHeader } from '../../mobile-placement/haizen/HaizenHeader';
import { HaizenIcon } from '../../mobile-placement/haizen/HaizenIcon';
import { HaizenSheet } from '../../mobile-placement/haizen/HaizenSheet';
import { haizenPhoneStyle, hp } from '../../mobile-placement/ui/haizenPhoneTokens';
import { buildPurchaseOrderRowLines } from '../model/buildPurchaseOrderRowLines';

import type { usePurchaseOrderLookup } from '../hooks/usePurchaseOrderLookup';

export function PurchaseOrderLookupPhoneView({ lookup }: { lookup: ReturnType<typeof usePurchaseOrderLookup> }) {
  const navigate = useNavigate();
  const [manualOpen, setManualOpen] = useState(false);
  const [manualNo, setManualNo] = useState('');
  const { orderNo, result, loading, error } = lookup;
  // A new lookup can be pending while the hook retains the previous response.
  const currentResult = result?.purchaseOrderNo === orderNo && !loading && !error ? result : null;
  return <div style={haizenPhoneStyle} className={hp.screen}>
    <div className={hp.content}>
      <HaizenHeader title="購買照会" onBack={() => navigate('/kiosk/mobile-placement')} />
      <section aria-label="注文番号" className="relative mx-3.5 mb-2.5 mt-0.5 shrink-0 rounded-[18px] border border-[var(--hp-line)] bg-[var(--hp-panel)] py-3.5 pl-5 pr-4 before:absolute before:bottom-4 before:left-0 before:top-4 before:w-1 before:rounded-r before:bg-[var(--hp-lime)]">
        <div className="flex justify-between text-[13px] font-bold tracking-[.06em] text-[var(--hp-lime)]">注文番号<span className={hp.muted}>{currentResult ? `${currentResult.rows.length}件` : ''}</span></div>
        <div aria-label={`注文番号 ${orderNo || '未入力'}`} className="mt-0.5 whitespace-nowrap font-mono text-[36px] font-bold leading-[1.2] tracking-[.04em] tabular-nums">
          {orderNo}<span aria-hidden className="text-[var(--hp-line)]">{'0'.repeat(Math.max(0, 10 - orderNo.length))}</span>
        </div>
      </section>
      <section aria-label="照会結果" aria-live="polite" className={hp.list}>
        {loading ? <p className={hp.empty}>照会中…</p> : error ? <p role="alert" className={`${hp.empty} !text-[var(--hp-ng)]`}>{error}</p>
          : currentResult ? currentResult.rows.length === 0 && <p className={hp.empty}>データがありません</p>
            : <div className={`${hp.empty} grid justify-items-center gap-2.5`}><HaizenIcon name="scan" className="h-11 w-11" />現品票のバーコードを読む</div>}
        {currentResult?.rows.map((row, index) => {
          const vm = buildPurchaseOrderRowLines(row);
          return <article key={`${row.seiban}-${row.purchasePartCodeNormalized}-${index}`} aria-label="照会結果1件"
            className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] gap-x-2.5 gap-y-2 rounded-2xl border border-[var(--hp-line)] bg-[var(--hp-panel)] px-3.5 py-3">
            <span className="break-words font-mono text-2xl font-black leading-[1.1]">{vm.machineName}</span>
            <span className="font-mono text-[28px] font-bold leading-[1.1] text-[var(--hp-lime)]">{vm.quantityDisplay}<small className={`ml-0.5 font-sans text-[13px] ${hp.faint}`}>個</small></span>
            <dl className="col-span-2 grid grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)] items-baseline gap-x-2.5 gap-y-1.5 text-[15px] [&_dt]:text-xs [&_dt]:font-bold [&_dt]:text-[var(--hp-ink3)] [&_dd]:break-words [&_dd]:font-mono [&_dd]:font-bold">
              <dt>製番</dt><dd>{vm.seiban}</dd><dt>着手</dt><dd>{vm.plannedStartDisplay}</dd>
              <dt>品名</dt><dd className="!font-sans !font-black">{vm.purchasePartName}</dd><dt>品番</dt><dd>{vm.partCode}</dd>
            </dl>
            {vm.hinmeiSubLine && <p className="col-span-2 text-xs font-bold text-[var(--hp-shelf)]">部品マスタでは「{row.masterPartName.trim()}」</p>}
          </article>;
        })}
      </section>
      <button type="button" className={`mx-auto shrink-0 text-xs ${hp.muted}`} onClick={() => { setManualNo(orderNo); setManualOpen(true); }}>手入力</button>
      <footer className={hp.dock}>
        <button type="button" className={`${hp.primary} bg-[var(--hp-lime)]`} onClick={() => lookup.setScanOpen(true)}>
          <HaizenIcon name="scan" className="h-[26px] w-[26px] shrink-0" />{result ? '次の注文番号を読む' : '注文番号を読む'}
        </button>
      </footer>
    </div>
    {manualOpen && <HaizenSheet title="注文番号を入力" onClose={() => setManualOpen(false)}>
      <form className="flex items-end gap-2" onSubmit={(event) => { event.preventDefault(); if (/^\d{10}$/.test(manualNo)) { lookup.onScanSuccess(manualNo); setManualOpen(false); } }}>
        <label className={`flex min-w-0 flex-1 flex-col gap-1 text-[13px] ${hp.muted}`}>注文番号10桁
          <input className={hp.input} inputMode="numeric" autoComplete="off" maxLength={10} value={manualNo} onChange={(event) => setManualNo(event.target.value.replace(/\D/g, '').slice(0, 10))} />
        </label>
        <button type="submit" className={`${hp.mini} !h-11`} disabled={!/^\d{10}$/.test(manualNo)}>照会</button>
      </form>
    </HaizenSheet>}
  </div>;
}
