import { useState } from 'react';

import { ShelfPhoto } from '../shelfPhoto/ShelfPhoto';
import { haizenPhoneColors as colors, haizenPhoneStyle, hp } from '../ui/haizenPhoneTokens';

import { HaizenIcon } from './HaizenIcon';
import { HaizenSheet } from './HaizenSheet';
import { HaizenShelfPhotoPicker } from './HaizenShelfPhotoPicker';
import { HaizenStub } from './HaizenStub';
import { useHaizenWorkflow } from './useHaizenWorkflow';

import type { HaizenState } from './useHaizenWorkflow';
import type { useOrderPlacementBranches } from '../useOrderPlacementBranches';
import type { useRegisteredShelves } from '../useRegisteredShelves';

const menuTiles = [
  { label: '部品を探す', hint: '名前から棚を見つける', path: '/kiosk/mobile-placement/part-search', icon: 'search', color: colors.shelf },
  { label: '購買照会', hint: '注文番号を読む', path: '/kiosk/purchase-order-lookup', icon: 'receipt', color: colors.lime },
  { label: 'パレット', hint: '加工機ごとの部品', path: '/kiosk/mobile-placement/pallet-viz', icon: 'pallet', color: colors.teal },
  { label: 'Zero2W 配膳', hint: '棚スキャナの記録', path: '/kiosk/mobile-placement/zero2w-status', icon: 'zero', color: colors.slip },
  { label: '棚マスタ', hint: '工場の棚の配置を変える', path: '/kiosk/mobile-placement/shelf-master', icon: 'grid', color: colors.actual }
] as const;

export type HaizenHubSheet = 'menu' | 'shelves' | 'inputs' | null;

export function HaizenHub({ mp, sheet, setSheet, shelves, branches, suggestedNextBranchNo, onNavigate, onShelfMaster, onPhoto }: {
  mp: HaizenState; shelves: ReturnType<typeof useRegisteredShelves>;
  sheet: HaizenHubSheet; setSheet: (sheet: HaizenHubSheet) => void;
  branches: ReturnType<typeof useOrderPlacementBranches>; suggestedNextBranchNo: number;
  onNavigate: (path: string) => void; onShelfMaster: () => void; onPhoto: () => void;
}) {
  const [tab, setTab] = useState<'verify' | 'place'>(() => {
    try { return localStorage.getItem('haizen-tab') === 'place' ? 'place' : 'verify'; } catch { return 'verify'; }
  });
  const switchTab = (next: 'verify' | 'place') => {
    setTab(next);
    try { localStorage.setItem('haizen-tab', next); } catch { /* Storage may be disabled on the kiosk. */ }
  };
  const flow = useHaizenWorkflow(mp, tab === 'verify');
  const selectedShelf = shelves.data?.shelves.find((s) => s.shelfCodeRaw === mp.shelfCode);
  const clearActual = () => {
    mp.setActualOrder(''); mp.setActualFseiban(''); mp.setActualPart('');
    mp.resetSlipResult(); mp.resetActualSlipOcrFeedback();
  };
  const change = (setter: (value: string) => void, value: string, actual = false) => {
    setter(value);
    mp.resetSlipResult();
    if (actual) mp.resetActualSlipOcrFeedback();
  };
  const fields = [
    { label: '移動票 製造order', value: mp.transferOrder, set: mp.setTransferOrder, scan: 'transferOrder', actual: false },
    { label: '現品票 注文番号 / 製造order', value: mp.actualOrder, set: mp.setActualOrder, scan: 'actualOrder', actual: true },
    { label: '移動票 部品番号', value: mp.transferPart, set: mp.setTransferPart, scan: 'transferPart', actual: false },
    { label: '現品票 部品番号', value: mp.actualPart, set: mp.setActualPart, scan: 'actualPart', actual: true },
    { label: '現品票 製番', value: mp.actualFseiban, set: mp.setActualFseiban, scan: null, actual: true }
  ] as const;
  const cfg = !mp.transferOrder.trim() ? { label: '移動票を読む', color: colors.slip, action: () => mp.setScanField('transferOrder') }
    : tab === 'place' ? !mp.shelfCode.trim()
      ? { label: '棚の写真を選ぶ', color: colors.shelf, action: () => setSheet('shelves') }
      : { label: `${mp.shelfCode} に置く`, color: colors.shelf, action: () => void mp.runRegister() }
    : flow.result === 'ok' ? { label: '次を照合', color: colors.ink, action: () => { clearActual(); mp.setTransferOrder(''); mp.setTransferPart(''); } }
    : flow.result === 'error' ? { label: '再試行', color: colors.actual, action: flow.retry }
    : { label: flow.result === 'ng' || flow.result === 'not-found' ? '現品票を読み直す' : '現品票を読む', color: flow.result === 'ng' ? colors.ng : colors.actual, action: () => { clearActual(); mp.setScanField('actualOrder'); } };
  const disabled = mp.registerSubmitting || mp.actualSlipImageOcrBusy || (tab === 'verify' && flow.pending) ||
    (tab === 'place' && Boolean(mp.transferOrder.trim() && mp.shelfCode.trim()) && mp.registerDisabled);
  const resultTitle = flow.result === 'ok' ? '一致' : flow.result === 'ng' ? '不一致' : flow.result === 'not-found' ? (mp.slipDetails?.reason === 'part_required' ? 'あと1つ' : '未登録') : '照合できませんでした';
  const resultColor = flow.result === 'ok' ? colors.ok : flow.result === 'ng' ? colors.ng : colors.shelf;

  return <div style={haizenPhoneStyle} className={`fixed inset-0 z-40 flex h-dvh flex-col ${hp.surface} [&_button:focus-visible]:outline [&_button:focus-visible]:outline-2 [&_button:focus-visible]:outline-offset-2 [&_button:focus-visible]:outline-[var(--hp-ink)]`}>
    <div className="relative mx-auto flex min-h-0 w-full max-w-[480px] flex-1 flex-col">
      <header className="flex items-center gap-2 px-3.5 pb-2 pt-3.5">
        <div role="tablist" aria-label="作業" className="grid flex-1 grid-cols-2 gap-1 rounded-[14px] border border-[var(--hp-line)] bg-[var(--hp-panel)] p-1">
          {(['verify', 'place'] as const).map((t) => <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => switchTab(t)}
            className="h-10 rounded-[10px] text-[17px] font-black tracking-widest text-[var(--hp-ink2)] aria-selected:bg-[var(--hp-ink)] aria-selected:text-[var(--hp-bg)]">{t === 'verify' ? '照合' : '配膳'}</button>)}
        </div>
        <button type="button" aria-label="ほかの画面" onClick={() => setSheet('menu')} className="grid h-12 w-12 place-items-center rounded-[14px] border border-[var(--hp-line)] bg-[var(--hp-panel)]">•••</button>
      </header>
      <main className="flex min-h-0 flex-1 flex-col gap-2.5 px-3.5 pt-1.5">
        <HaizenStub label="移動票" subtitle="製造order" prompt="バーコードを読む" value={mp.transferOrder} color={colors.slip} active={!mp.transferOrder.trim()}
          onScan={() => mp.setScanField('transferOrder')} onClear={() => change(mp.setTransferOrder, '')} />
        {tab === 'verify' ? <>
          <HaizenStub label="現品票" subtitle={mp.actualOrder || !mp.actualFseiban ? '注文番号' : '製番'} prompt="バーコードを読む" value={mp.actualOrder || mp.actualFseiban} color={colors.actual}
            active={Boolean(mp.transferOrder.trim()) && flow.result !== 'ok'} locked={!mp.transferOrder.trim()}
            onScan={() => mp.setScanField('actualOrder')} onClear={clearActual} />
          {mp.actualSlipImageOcrBusy && <p role="status" className={hp.muted}>写真を読取中…</p>}
          {mp.actualSlipOcrFeedback.message && <p role="status" className={`text-sm ${hp.muted}`}>{mp.actualSlipOcrFeedback.message}</p>}
          {flow.pending ? <p role="status" aria-label="照合中" className={hp.muted}>照合中…</p> : flow.result !== 'idle' && <section role="status" aria-label={resultTitle}
            style={{ color: resultColor, background: `color-mix(in srgb, ${resultColor} 10%, ${colors.bg})` }} className="flex flex-col gap-2 rounded-2xl border-2 border-current p-4">
            <div className={`flex items-center gap-2.5 font-black ${flow.result === 'error' ? 'text-2xl' : 'text-[34px] tracking-widest'}`}>
              <span aria-hidden>{flow.result === 'ok' ? '✓' : flow.result === 'ng' ? '×' : '?'}</span>{resultTitle}
            </div>
            {flow.result === 'ng' && <p className="text-base font-bold text-[var(--hp-ink)]">{mp.slipDetails?.reason === 'different_seiban'
              ? `この注文は別の製番(${mp.slipDetails.actual?.fseiban ?? '不明'})の材料です` : '部品が違います'}</p>}
            {flow.result === 'not-found' && <>
              <p className="text-base font-bold text-[var(--hp-ink)]">{mp.slipDetails?.reason === 'transfer_not_found' ? 'この製造orderが見つかりません' : mp.slipDetails?.reason === 'part_required' ? '部品番号も読んでください' : 'この注文番号はまだ届いていません'}</p>
              <div className="flex gap-2"><button type="button" className={`${hp.mini} !h-11 flex-1`} onClick={onPhoto}>写真で製番</button><button type="button" className={`${hp.mini} !h-11 flex-1`} onClick={() => setSheet('inputs')}>部品番号</button></div>
            </>}
            {(flow.result === 'ok' || flow.result === 'ng') && mp.slipDetails?.expected && <div className="flex flex-wrap items-baseline gap-x-2 font-mono text-[17px] font-bold text-[var(--hp-ink)]">
              <span>{mp.slipDetails.expected.fseiban}</span><span>{mp.slipDetails.expected.fhincd}</span><span className={`font-sans text-[13px] ${hp.muted}`}>{mp.slipDetails.expected.partName}</span>
            </div>}
            {flow.result === 'ok' && mp.slipDetails?.matchedBy === 'part_name' && <p className={`text-sm ${hp.muted}`}>素材 <span className="font-mono">{mp.slipDetails.actual?.partCode}</span> を品名で照合</p>}
          </section>}
        </> : <>
          <HaizenStub label="棚" subtitle="置く場所" prompt="写真から選ぶ" value={mp.shelfCode} color={colors.shelf} active={Boolean(mp.transferOrder.trim()) && !mp.shelfCode}
            locked={!mp.transferOrder.trim()} onScan={() => setSheet('shelves')} onClear={() => mp.selectShelf('')}
            thumbnail={selectedShelf && <ShelfPhoto shelf={selectedShelf} className="h-[66px] w-[88px] rounded-[10px]" />}>
            {selectedShelf?.displayLabel && <p className={`truncate text-sm ${hp.muted}`}>{selectedShelf.displayLabel}</p>}
          </HaizenStub>
        {mp.shelfCode && <>
          {branches.isLoading && <p className={`text-[11px] ${hp.muted}`}>分配一覧を読み込み中…</p>}
          {branches.isError && <div role="alert" className="text-[13px] text-[var(--hp-ng)]">分配一覧の取得に失敗しました <button type="button" className={hp.mini} onClick={() => void branches.refetch()}>再試行</button></div>}
          {!!branches.data?.branches.length && <div className="flex min-h-11 items-center gap-2 px-0.5 pt-0.5">
            <span className={`shrink-0 text-[13px] font-bold ${hp.muted}`}>分配</span>
            <div role="group" aria-label="分配" className="flex min-w-0 gap-1.5 overflow-x-auto">
              <button type="button" className={hp.segment} aria-pressed={mp.orderPlacementIntent === 'create_new_branch'} onClick={() => { mp.setOrderPlacementIntent('create_new_branch'); mp.setSelectedBranchId(null); }}>
                新規 <span className={`text-[11px] font-medium ${hp.muted}`}>分配{suggestedNextBranchNo}</span>
              </button>
              {branches.data.branches.map((b) => <button key={b.id} type="button" className={hp.segment} aria-pressed={mp.orderPlacementIntent === 'move_existing' && mp.selectedBranchId === b.id}
                onClick={() => { mp.setOrderPlacementIntent('move_existing'); mp.setSelectedBranchId(b.id); }}>
                分配{b.branchNo} <span className={`text-[11px] font-medium ${hp.muted}`}>{b.shelfCodeRaw}</span>
              </button>)}
            </div>
          </div>}
        </>}
        </>}
        <button type="button" className={`self-start py-1.5 text-[13px] font-bold underline underline-offset-4 ${hp.muted}`} onClick={() => setSheet('inputs')}>手入力</button>
      </main>
      {(flow.toast || mp.registerError) && <div role={mp.registerError ? 'alert' : 'status'} className={`absolute bottom-24 left-3.5 right-3.5 z-20 flex items-center gap-2.5 rounded-[14px] bg-[var(--hp-ink)] px-4 py-[13px] text-[15px] font-black ${mp.registerError ? 'text-red-700' : 'text-[var(--hp-bg)]'}`}>
        {!mp.registerError && <HaizenIcon name="check" />}<span className="break-words">{mp.registerError || flow.toast}</span>
      </div>}
      <footer className={hp.dock}>
        <button type="button" disabled={disabled} style={{ background: cfg.color }} className={hp.primary} onClick={cfg.action}>
          <HaizenIcon name={tab === 'place' && mp.shelfCode || flow.result === 'ok' ? 'check' : 'scan'} className="h-[26px] w-[26px] shrink-0" />
          <span>{mp.registerSubmitting ? '処理中…' : tab === 'verify' && flow.pending ? '照合中…' : cfg.label}</span>
        </button>
      </footer>
    </div>
    {sheet === 'shelves' && <HaizenShelfPhotoPicker shelves={shelves.data?.shelves ?? []} previousShelfCodes={[...new Set(branches.data?.branches.map((b) => b.shelfCodeRaw) ?? [])]}
      loading={shelves.isLoading} error={shelves.isError} onRetry={() => void shelves.refetch()} selected={mp.shelfCode}
      onSelect={(code) => { mp.selectShelf(code); setSheet(null); }} onClose={() => setSheet(null)}
      onScan={() => { setSheet(null); mp.setScanField('shelf'); }} onMaster={onShelfMaster} />}
    {sheet && sheet !== 'shelves' && <HaizenSheet title={sheet === 'menu' ? 'ほかの画面' : '部品番号・手入力'} onClose={() => setSheet(null)}>
      {sheet === 'menu' && <div className="grid grid-cols-2 gap-2">
        {menuTiles.map((tile, i) => <button key={tile.path} type="button" aria-label={tile.label} onClick={() => onNavigate(tile.path)}
          className={`flex rounded-2xl border border-[var(--hp-line)] bg-[var(--hp-bg)] px-3.5 py-3 text-left text-base font-black leading-tight ${i === 4 ? 'col-span-2 h-16 flex-row items-center gap-3.5' : 'h-[88px] flex-col items-start justify-between'}`}>
          <span style={{ color: tile.color }}><HaizenIcon name={tile.icon} /></span><span>{tile.label}<small className={`mt-0.5 block text-[11px] font-bold tracking-[.02em] ${hp.faint}`}>{tile.hint}</small></span>
        </button>)}
      </div>}
      {sheet === 'inputs' && <>
        <div className="flex items-center justify-between"><h2 className="font-bold">部品番号・手入力</h2><button type="button" className={hp.mini} onClick={() => setSheet(null)}>完了</button></div>
        {fields.map((field) => <label key={field.label} className={`flex flex-col gap-1 text-[13px] ${hp.muted}`}>
          {field.label}<span className="flex gap-2"><input className={`${hp.input} flex-1`} value={field.value} onChange={(e) => change(field.set, e.target.value, field.actual)} />
            {field.scan && <button type="button" aria-label={`${field.label}をスキャン`} className={`${hp.mini} !h-11`} onClick={() => { setSheet(null); mp.setScanField(field.scan); }}><HaizenIcon name="scan" className="h-5 w-5" /></button>}
          </span>
        </label>)}
      </>}
    </HaizenSheet>}
  </div>;
}
