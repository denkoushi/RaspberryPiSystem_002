import { haizenPhoneColors as colors, haizenPhoneStyle, hp } from '../ui/haizenPhoneTokens';

import { HaizenHeader } from './HaizenHeader';
import { HaizenIcon } from './HaizenIcon';
import { HaizenSheet } from './HaizenSheet';
import { HaizenShelfPicker } from './HaizenShelfPicker';
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
  const flow = useHaizenWorkflow(mp);
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
  const cfg = flow.step === 'transferOrder' ? { label: '移動票を読む', color: colors.slip }
    : flow.step === 'actualOrder' ? { label: flow.result === 'ng' ? '現品票を読み直す' : '現品票を読む', color: flow.result === 'ng' ? colors.ng : colors.actual }
    : flow.step === 'shelf' ? { label: '棚を読む', color: colors.shelf }
    : { label: `棚 ${mp.shelfCode} に置く`, color: colors.ok };
  const disabled = mp.registerSubmitting || mp.actualSlipImageOcrBusy || flow.pending ||
    (flow.step === 'register' && (mp.registerDisabled || flow.result !== 'ok'));

  return <div style={haizenPhoneStyle} className={`fixed inset-0 z-40 flex h-dvh flex-col ${hp.surface} [&_button:focus-visible]:outline [&_button:focus-visible]:outline-2 [&_button:focus-visible]:outline-offset-2 [&_button:focus-visible]:outline-[var(--hp-ink)]`}>
    <div className="relative mx-auto flex min-h-0 w-full max-w-[480px] flex-1 flex-col">
      <HaizenHeader title="配膳">
        <div className="ml-auto flex gap-1" aria-label="進捗">
          {[Boolean(mp.transferOrder.trim()), flow.result === 'ok', Boolean(mp.shelfCode.trim())].map((done, i) =>
            <span key={i} aria-label={`${['移動票', '現品票', '棚'][i]} ${done ? '完了' : '未完了'}`} className={`h-1 w-[18px] rounded-sm ${done ? 'bg-[var(--hp-ink)]' : 'bg-[var(--hp-line)]'}`} />)}
        </div>
        <button type="button" aria-label="ほかの画面" onClick={() => setSheet('menu')} className="grid h-10 w-10 place-items-center rounded-xl border border-[var(--hp-line)] bg-[var(--hp-panel)]">
          <svg aria-hidden className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
        </button>
      </HaizenHeader>
      <main className="flex min-h-0 flex-1 flex-col gap-2.5 px-3.5 pt-1.5">
        <HaizenStub label="移動票" prompt="製造order を読む" value={mp.transferOrder} color={colors.slip} active={flow.step === 'transferOrder'}
          onScan={() => mp.setScanField('transferOrder')} onClear={() => change(mp.setTransferOrder, '')}
          aside={<button type="button" className={`text-[11px] ${hp.muted}`} onClick={() => setSheet('inputs')}>手入力</button>} />
        <div className="relative">
          <HaizenStub label="現品票" prompt="注文番号 を読む" value={mp.actualOrder} color={colors.actual} active={flow.step === 'actualOrder'} locked={!mp.transferOrder.trim()}
            onScan={() => mp.setScanField('actualOrder')} onClear={() => change(mp.setActualOrder, '', true)}
            aside={!mp.actualOrder && <button type="button" aria-label="写真から読む" className={hp.mini} disabled={mp.actualSlipImageOcrBusy || mp.registerSubmitting} onClick={onPhoto}><HaizenIcon name="photo" className="h-[18px] w-[18px]" />写真</button>}>
            <div className="flex items-center gap-2 pr-16">
              <button type="button" className={`py-1 text-[11px] ${hp.muted}`} onClick={() => setSheet('inputs')}>部品番号・手入力</button>
              {flow.result === 'ng' && <span role="alert" className="text-[13px] font-bold text-[var(--hp-ng)]">NG・不一致</span>}
            </div>
            {mp.actualSlipOcrFeedback.message && <p role="status" className={`pr-16 text-[11px] ${hp.muted}`}>{mp.actualSlipOcrFeedback.message}</p>}
            {mp.actualSlipImageOcrBusy && <p role="status" className={`text-[11px] ${hp.muted}`}>写真を読取中…</p>}
          </HaizenStub>
          {(flow.pending || flow.result !== 'idle') && <div role="status" aria-label={flow.pending ? '照合中' : flow.result === 'ok' ? '一致' : '不一致'}
            style={{ color: flow.pending ? colors.ink2 : flow.result === 'ok' ? colors.ok : colors.ng }}
            className="pointer-events-none absolute -bottom-1 right-3.5 z-10 grid h-16 w-16 -rotate-12 place-items-center rounded-full border-[3px] border-current bg-[var(--hp-bg)] text-center font-black leading-none">
            <div><div className="text-[26px]">{flow.pending ? '…' : flow.result === 'ok' ? '合' : '違'}</div><div className="mt-0.5 text-[11px] tracking-widest">{flow.pending ? '照合中' : flow.result === 'ok' ? '一致' : '不一致'}</div></div>
          </div>}
        </div>
        <HaizenStub label="棚" prompt="棚の QR を読む" value={mp.shelfCode} color={colors.shelf} active={flow.step === 'shelf' && !flow.pending} locked={flow.result !== 'ok'}
          onScan={() => mp.setScanField('shelf')} onClear={() => mp.selectShelf('')} />
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
      </main>
      {(flow.toast || mp.registerError) && <div role={mp.registerError ? 'alert' : 'status'} className={`absolute bottom-24 left-3.5 right-3.5 z-20 flex items-center gap-2.5 rounded-[14px] bg-[var(--hp-ink)] px-4 py-[13px] text-[15px] font-black ${mp.registerError ? 'text-red-700' : 'text-[var(--hp-bg)]'}`}>
        {!mp.registerError && <HaizenIcon name="check" />}<span className="break-words">{mp.registerError || flow.toast}</span>
      </div>}
      <footer className={hp.dock}>
        <button type="button" disabled={disabled} style={{ background: cfg.color }} className="flex h-16 min-w-0 flex-1 items-center justify-center gap-3 rounded-[18px] px-3 text-[19px] font-black tracking-[.04em] text-[var(--hp-bg)] active:scale-[.98] disabled:opacity-40"
          onClick={() => { if (flow.step === 'register') void mp.runRegister(); else mp.setScanField(flow.step); }}>
          <HaizenIcon name={flow.step === 'register' ? 'check' : flow.step === 'shelf' ? 'grid' : 'scan'} className="h-[26px] w-[26px] shrink-0" />
          <span className={flow.step === 'register' ? 'break-all font-mono text-[21px] tabular-nums' : ''}>{mp.registerSubmitting ? '処理中…' : flow.pending ? '照合中…' : cfg.label}</span>
        </button>
        {flow.step === 'shelf' && !flow.pending && <button type="button" aria-label="一覧から棚を選ぶ" className="grid h-16 w-16 shrink-0 content-center justify-items-center gap-0.5 rounded-[18px] border border-[var(--hp-line)] bg-[var(--hp-panel)] text-[11px] font-bold" onClick={() => setSheet('shelves')}><HaizenIcon name="grid" />一覧</button>}
      </footer>
    </div>
    {sheet && <HaizenSheet title={sheet === 'menu' ? 'ほかの画面' : sheet === 'shelves' ? '一覧から棚を選ぶ' : '部品番号・手入力'} onClose={() => setSheet(null)}>
      {sheet === 'menu' && <div className="grid grid-cols-2 gap-2">
        {menuTiles.map((tile, i) => <button key={tile.path} type="button" aria-label={tile.label} onClick={() => onNavigate(tile.path)}
          className={`flex rounded-2xl border border-[var(--hp-line)] bg-[var(--hp-bg)] px-3.5 py-3 text-left text-base font-black leading-tight ${i === 4 ? 'col-span-2 h-16 flex-row items-center gap-3.5' : 'h-[88px] flex-col items-start justify-between'}`}>
          <span style={{ color: tile.color }}><HaizenIcon name={tile.icon} /></span><span>{tile.label}<small className={`mt-0.5 block text-[11px] font-bold tracking-[.02em] ${hp.faint}`}>{tile.hint}</small></span>
        </button>)}
      </div>}
      {sheet === 'shelves' && <HaizenShelfPicker shelves={shelves.data?.shelves ?? []} loading={shelves.isLoading} error={shelves.isError} onRetry={() => void shelves.refetch()} selected={mp.shelfCode}
        onSelect={(code) => { mp.selectShelf(code); setSheet(null); }} onMaster={onShelfMaster} />}
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
