import { useEffect, useRef, useState } from 'react';

import { BarcodeScanModal, KIOSK_STANDARD_BARCODE_SCAN_SESSION } from '../../barcode-scan';
import { MobileOfflineChip } from '../local-data/MobileOfflineChip';
import { useMobileLocalData } from '../local-data/useMobileLocalData';
import { useShelfOfflineQueue } from '../shelfMaster/offline/useShelfOfflineQueue';
import { haizenPhoneColors as colors, haizenPhoneStyle, hp } from '../ui/haizenPhoneTokens';
import { useShelfMachines } from '../useShelfMachines';

import { HaizenBottomNav } from './HaizenBottomNav';
import { HaizenIcon } from './HaizenIcon';
import { HaizenSheet } from './HaizenSheet';
import { HaizenShelfPhotoList, HaizenShelfPhotoPicker } from './HaizenShelfPhotoPicker';
import { HaizenStub } from './HaizenStub';
import { createHaizenClientRecordId } from './offline/haizenOfflineQueueStore';
import { useHaizenOfflineQueue } from './offline/useHaizenOfflineQueue';
import { useHaizenWorkflow } from './useHaizenWorkflow';

import type { HaizenState } from './useHaizenWorkflow';
import type { useOrderPlacementBranches } from '../useOrderPlacementBranches';
import type { useRegisteredShelves } from '../useRegisteredShelves';

const menuTiles = [
  { label: 'パレット', hint: '加工機ごとの部品', path: '/kiosk/mobile-placement/pallet-viz', icon: 'pallet', color: colors.teal },
  { label: 'Zero2W 配膳', hint: '棚スキャナの記録', path: '/kiosk/mobile-placement/zero2w-status', icon: 'zero', color: colors.slip },
  { label: '棚マスタ', hint: '工場の棚の配置を変える', path: '/kiosk/mobile-placement/shelf-master', icon: 'grid', color: colors.actual }
] as const;

export type HaizenHubSheet = 'menu' | 'shelves' | 'inputs' | 'pending' | 'needs_check' | null;

export function HaizenHub({ mp, sheet, setSheet, shelves, branches, onNavigate, onShelfMaster, onPhoto }: {
  mp: HaizenState; shelves: ReturnType<typeof useRegisteredShelves>;
  sheet: HaizenHubSheet; setSheet: (sheet: HaizenHubSheet) => void;
  branches: ReturnType<typeof useOrderPlacementBranches>;
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
  const queue = useHaizenOfflineQueue();
  const localData = useMobileLocalData('verify');
  useShelfOfflineQueue();
  useShelfMachines();
  const [placeSlip, setPlaceSlip] = useState<{ kind: 'mo' | 'po'; number: string } | null>(null);
  const [selectedBranchNo, setSelectedBranchNo] = useState<number | null>(null);
  const [branchSelectionVersion, setBranchSelectionVersion] = useState(0);
  const retakeSelection = useRef<{ branchNo?: number; shelfCode: string } | null>(null);
  const [scannedAt, setScannedAt] = useState('');
  const [placeToast, setPlaceToast] = useState<string | null>(null);
  const [putting, setPutting] = useState(false);
  const putInFlight = useRef(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const hasPlaceSlip = Boolean(placeSlip?.number.trim());
  const { setOrderBarcode } = mp;
  const knownBranches = hasPlaceSlip && mp.orderBarcode === placeSlip?.number && branches.branchStatus === 'known'
    ? branches.data?.branches : undefined;
  const selectedBranch = knownBranches?.find((branch) => branch.branchNo === selectedBranchNo);
  const hasNone = knownBranches?.some((branch) => branch.branchNo === 0) ?? false;
  const hasNumbered = knownBranches?.some((branch) => branch.branchNo > 0) ?? false;
  useEffect(() => {
    if (tab === 'place') setOrderBarcode(placeSlip?.number ?? '');
  }, [tab, placeSlip, setOrderBarcode]);
  useEffect(() => {
    if (!knownBranches) return;
    const onlyNone = knownBranches.length === 1 && knownBranches[0].branchNo === 0;
    if (selectedBranchNo !== null && (selectedBranchNo === 0 ? hasNumbered : hasNone)) {
      setSelectedBranchNo(onlyNone ? 0 : null);
    } else if (selectedBranchNo === null && onlyNone) {
      setSelectedBranchNo(0);
    }
  }, [knownBranches, placeSlip, selectedBranchNo, hasNumbered, hasNone]);
  useEffect(() => {
    if (!placeToast) return;
    const timer = window.setTimeout(() => setPlaceToast(null), 3000);
    return () => window.clearTimeout(timer);
  }, [placeToast]);
  const readPlaceSlip = (kind: 'mo' | 'po', number: string, selection: { branchNo?: number; shelfCode: string } | null = null) => {
    setPlaceSlip({ kind, number: number.trim() });
    setScannedAt(new Date().toISOString());
    setSelectedBranchNo(selection?.branchNo ?? null);
    if (selection) mp.selectShelf(selection.shelfCode);
    retakeSelection.current = null;
  };
  const put = async () => {
    if (putInFlight.current || !placeSlip?.number.trim() || selectedBranchNo === null || !mp.shelfCode.trim() || selectedBranch?.shelfCodeRaw === mp.shelfCode) return;
    putInFlight.current = true;
    setPutting(true);
    try {
      const result = await queue.submit({
        clientRecordId: createHaizenClientRecordId(), slipKind: placeSlip.kind === 'mo' ? 'manufacturing_order' : 'purchase_order',
        number: placeSlip.number, shelfCode: mp.shelfCode, scannedAt, branchNo: selectedBranchNo
      });
      setPlaceToast(result.status === 'sent'
        ? `分配${result.response.branchState.branchNo === 0 ? 'なし' : result.response.branchState.branchNo}を${result.response.action === 'unchanged' ? '確認しました' : result.response.action === 'moved' || (!result.response.action && selectedBranch) ? '移しました' : '置きました'}`
        : result.status === 'pending' ? `スマホに保存しました（未送信 ${result.pendingCount}件）` : '要確認に保存しました');
      setPlaceSlip(null); setSelectedBranchNo(null);
    } finally { putInFlight.current = false; setPutting(false); }
  };
  const toast = tab === 'place' ? placeToast : flow.toast;
  const registerError = tab === 'place' ? null : mp.registerError;

  const previousShelfCodes = selectedBranch ? [selectedBranch.shelfCodeRaw] : [];
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
  const cfg = tab === 'place' ? !hasPlaceSlip
      ? { label: '票を読む', color: colors.shelf, action: () => mp.setScanField(placeSlip?.kind === 'po' ? 'placePurchaseOrder' : 'transferOrder') }
      : selectedBranch?.shelfCodeRaw === mp.shelfCode ? { label: '今と同じ棚です', color: colors.shelf, action: () => undefined }
      : { label: selectedBranch ? 'ここへ移す' : 'ここに置く', color: colors.shelf, action: () => void put() }
    : !mp.transferOrder.trim() ? { label: '移動票を読む', color: colors.slip, action: () => mp.setScanField('transferOrder') }
    : flow.result === 'ok' ? { label: '次を照合', color: colors.ink, action: () => { clearActual(); mp.setTransferOrder(''); mp.setTransferPart(''); } }
    : flow.result === 'error' ? { label: '再試行', color: colors.actual, action: flow.retry }
    : { label: flow.result === 'ng' || flow.result === 'not-found' ? '現品票を読み直す' : '現品票を読む', color: flow.result === 'ng' ? colors.ng : colors.actual, action: () => { clearActual(); mp.setScanField('actualOrder'); } };
  const primaryLabel = putting || mp.registerSubmitting ? '処理中…' : tab === 'verify' && flow.pending ? '照合中…' : cfg.label;
  const disabled = putting || mp.registerSubmitting || mp.actualSlipImageOcrBusy || (tab === 'verify' && flow.pending) ||
    (tab === 'place' && (selectedBranchNo === null || !mp.shelfCode.trim() || selectedBranch?.shelfCodeRaw === mp.shelfCode || (selectedBranchNo === 0 ? hasNumbered : hasNone)));
  const resultTitle = flow.result === 'ok' ? '一致' : flow.result === 'ng' ? '不一致' : flow.result === 'not-found' ? (mp.slipDetails?.reason === 'part_required' ? 'あと1つ' : '未登録') : '照合できませんでした';
  const resultColor = flow.result === 'ok' ? colors.ok : flow.result === 'ng' ? colors.ng : colors.shelf;

  return <div style={haizenPhoneStyle} className={`fixed inset-0 z-40 flex h-dvh flex-col ${hp.surface} [&_button:focus-visible]:outline [&_button:focus-visible]:outline-2 [&_button:focus-visible]:outline-offset-2 [&_button:focus-visible]:outline-[var(--hp-ink)]`}>
    <div className="relative mx-auto flex min-h-0 w-full max-w-[480px] flex-1 flex-col">
      <main className="flex min-h-0 flex-1 flex-col gap-2.5 px-3.5 pt-3.5">
        {tab === 'verify' ? <>
          {localData.offline && <div className="flex shrink-0"><MobileOfflineChip {...localData} /></div>}
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
        {(queue.offline || queue.pending.length > 0 || queue.needsCheck.length > 0) && <div aria-label="送信状況" className="flex shrink-0 gap-1.5">
          {queue.offline && <span className={`${hp.chip} inline-flex items-center !text-[var(--hp-ng)]`}>圏外</span>}
          {queue.pending.length > 0 && <button type="button" className={`${hp.chip} !text-orange-400`} onClick={() => setSheet('pending')}>未送信 {queue.pending.length}</button>}
          {queue.needsCheck.length > 0 && <button type="button" className={`${hp.chip} !text-[var(--hp-ng)]`} onClick={() => { setConfirmDeleteId(null); setSheet('needs_check'); }}>要確認 {queue.needsCheck.length}</button>}
        </div>}
        {hasPlaceSlip && <div className="flex items-center gap-2 rounded-xl border border-[var(--hp-line)] bg-[var(--hp-panel)] py-0.5 pl-2.5 pr-1">
          <div className="flex min-w-0 flex-1 items-baseline gap-2"><p className={`shrink-0 whitespace-nowrap text-[13px] font-bold ${hp.muted}`}>{placeSlip?.kind === 'po' ? '現品票' : '移動票'}</p>
            <p className="break-all font-mono text-2xl font-bold">{placeSlip?.number}</p></div>
          <button type="button" aria-label="読み直す" className="h-8 w-8 shrink-0 rounded-lg border-0 bg-transparent text-lg text-[var(--hp-ink2)]" onClick={() => { setPlaceSlip(null); setSelectedBranchNo(null); }}>×</button>
        </div>}
        <section aria-label="棚の写真" className="flex min-h-0 flex-1 flex-col pt-1">
          <HaizenShelfPhotoList key={`${placeSlip?.number}:${selectedBranchNo}:${branchSelectionVersion}:${previousShelfCodes.join()}`} compact shelves={shelves.data?.shelves ?? []} previousShelfCodes={previousShelfCodes}
            loading={shelves.isLoading} error={shelves.isError} onRetry={() => void shelves.refetch()} selected={mp.shelfCode} onSelect={mp.selectShelf}
            disabled={!hasPlaceSlip || selectedBranchNo === null} onExpand={() => setSheet('shelves')}>
            {hasPlaceSlip && branches.branchStatus === 'loading' && <p className={`text-[11px] ${hp.muted}`}>分配一覧を読み込み中…</p>}
          </HaizenShelfPhotoList>
        </section>
        </>}
        <button type="button" className={`self-start py-1.5 text-[13px] font-bold underline underline-offset-4 ${hp.muted}`} onClick={() => setSheet('inputs')}>手入力</button>
      </main>
      {(toast || registerError) && <div role={registerError ? 'alert' : 'status'} className={`absolute bottom-24 left-3.5 right-3.5 z-20 flex items-center gap-2.5 rounded-[14px] bg-[var(--hp-ink)] px-4 py-[13px] text-[15px] font-black ${registerError ? 'text-red-700' : 'text-[var(--hp-bg)]'}`}>
        {!registerError && <HaizenIcon name="check" />}<span className="break-words">{registerError || toast}</span>
      </div>}
      {tab === 'verify' && <div className="flex shrink-0 flex-col gap-2.5 px-3.5 pt-2">
        <HaizenStub label="移動票" subtitle="製造order" prompt="バーコードを読む" value={mp.transferOrder} color={colors.slip} active={!mp.transferOrder.trim()}
          onScan={() => mp.setScanField('transferOrder')} onClear={() => change(mp.setTransferOrder, '')} />
        <HaizenStub label="現品票" subtitle={mp.actualOrder || !mp.actualFseiban ? '注文番号' : '製番'} prompt="バーコードを読む" value={mp.actualOrder || mp.actualFseiban} color={colors.actual}
          active={Boolean(mp.transferOrder.trim()) && flow.result !== 'ok'} locked={!mp.transferOrder.trim()}
          onScan={() => mp.setScanField('actualOrder')} onClear={clearActual} />
      </div>}
      {tab === 'place' && !hasPlaceSlip && <div className="grid shrink-0 grid-cols-2 gap-2 px-3.5 pt-2">
        <button type="button" className="rounded-2xl border-2 border-[var(--hp-line)] bg-[var(--hp-panel)] p-1 leading-[1.15] text-[var(--hp-slip)]" onClick={() => mp.setScanField('transferOrder')}>
          <span className="block text-2xl font-black leading-[1.15]">移動票</span><span className="text-[13px] font-bold">製造オーダー番号</span>
        </button>
        <button type="button" className="rounded-2xl border-2 border-[var(--hp-line)] bg-[var(--hp-panel)] p-1 leading-[1.15] text-[var(--hp-actual)]" onClick={() => mp.setScanField('placePurchaseOrder')}>
          <span className="block text-2xl font-black leading-[1.15]">現品票</span><span className="text-[13px] font-bold">注文番号</span>
        </button>
      </div>}
      {tab === 'place' && hasPlaceSlip && <div className="shrink-0 px-3.5 pt-2">
        <div role="group" aria-label="分配" className="grid grid-cols-[auto_repeat(5,minmax(0,1fr))] gap-1">
          {[0, 1, 2, 3, 4, 5].map((branchNo) => <button key={branchNo} type="button" aria-pressed={selectedBranchNo === branchNo}
            disabled={branchNo === 0 ? hasNumbered : hasNone}
            className="inline-flex h-9 items-center justify-center whitespace-nowrap rounded-lg border border-[var(--hp-line)] bg-[var(--hp-panel)] px-1.5 text-[15px] font-extrabold leading-none aria-pressed:border-[var(--hp-shelf)] aria-pressed:bg-[color-mix(in_srgb,var(--hp-panel)_70%,var(--hp-shelf))] disabled:opacity-30"
            onClick={() => { setSelectedBranchNo(branchNo); setBranchSelectionVersion((value) => value + 1); }}>
            分配{branchNo === 0 ? 'なし' : branchNo}
          </button>)}
        </div>
      </div>}
      <HaizenBottomNav active={tab} onMenu={() => setSheet('menu')} onSelect={(next) => {
        if (next === 'verify' || next === 'place') switchTab(next);
        else onNavigate(next === 'purchase' ? '/kiosk/purchase-order-lookup' : '/kiosk/mobile-placement/part-search');
      }}>
        {(tab === 'place' ? hasPlaceSlip : flow.pending || flow.result === 'ok' || flow.result === 'error') && <button type="button" disabled={disabled} style={{ background: cfg.color }} className={hp.bottomPrimary} onClick={cfg.action}>
          {primaryLabel}
        </button>}
      </HaizenBottomNav>
    </div>
    {sheet === 'shelves' && <HaizenShelfPhotoPicker shelves={shelves.data?.shelves ?? []} previousShelfCodes={previousShelfCodes}
      loading={shelves.isLoading} error={shelves.isError} onRetry={() => void shelves.refetch()} selected={mp.shelfCode}
      onSelect={(code) => { mp.selectShelf(code); setSheet(null); }} onClose={() => setSheet(null)}
      onScan={() => { setSheet(null); mp.setScanField('shelf'); }} onMaster={onShelfMaster} />}
    {(sheet === 'menu' || sheet === 'inputs') && <HaizenSheet title={sheet === 'menu' ? 'ほかの画面' : '部品番号・手入力'} onClose={() => setSheet(null)}>
      {sheet === 'menu' && <div className="grid grid-cols-2 gap-2">
        {menuTiles.map((tile, i) => <button key={tile.path} type="button" aria-label={tile.label} onClick={() => onNavigate(tile.path)}
          className={`flex rounded-2xl border border-[var(--hp-line)] bg-[var(--hp-bg)] px-3.5 py-3 text-left text-base font-black leading-tight ${i === menuTiles.length - 1 ? 'col-span-2 h-16 flex-row items-center gap-3.5' : 'h-[88px] flex-col items-start justify-between'}`}>
          <span style={{ color: tile.color }}><HaizenIcon name={tile.icon} /></span><span>{tile.label}<small className={`mt-0.5 block text-[11px] font-bold tracking-[.02em] ${hp.faint}`}>{tile.hint}</small></span>
        </button>)}
      </div>}
      {sheet === 'inputs' && <>
        <div className="flex items-center justify-between"><h2 className="font-bold">部品番号・手入力</h2><button type="button" className={hp.mini} onClick={() => setSheet(null)}>完了</button></div>
        {(tab === 'place' ? [
          { label: '移動票 製造order', value: placeSlip?.kind === 'mo' ? placeSlip.number : '', set: (value: string) => readPlaceSlip('mo', value), scan: 'transferOrder' as const, actual: false },
          { label: '現品票 注文番号', value: placeSlip?.kind === 'po' ? placeSlip.number : '', set: (value: string) => readPlaceSlip('po', value), scan: 'placePurchaseOrder' as const, actual: false }
        ] : fields).map((field) => <label key={field.label} className={`flex flex-col gap-1 text-[13px] ${hp.muted}`}>
          {field.label}<span className="flex gap-2"><input className={`${hp.input} flex-1`} value={field.value} onChange={(e) => tab === 'place' ? field.set(e.target.value) : change(field.set, e.target.value, field.actual)} />
            {field.scan && <button type="button" aria-label={`${field.label}をスキャン`} className={`${hp.mini} !h-11`} onClick={() => { setSheet(null); mp.setScanField(field.scan); }}><HaizenIcon name="scan" className="h-5 w-5" /></button>}
          </span>
        </label>)}
      </>}
    </HaizenSheet>}
    {(sheet === 'pending' || sheet === 'needs_check') && <HaizenSheet title={sheet === 'pending' ? '未送信' : '要確認'} onClose={() => setSheet(null)}>
      <div className="flex items-center justify-between"><h2 className="font-bold">{sheet === 'pending' ? '未送信' : '要確認'}</h2><button type="button" className={hp.mini} onClick={() => setSheet(null)}>閉じる</button></div>
      {(sheet === 'pending' ? queue.pending : queue.needsCheck).map((record) => <section key={record.clientRecordId} className="space-y-2 rounded-xl border border-[var(--hp-line)] p-3">
        <p className="break-all font-mono text-xl font-bold">{record.number}</p>
        <p className={`text-sm ${hp.muted}`}>{record.slipKind === 'purchase_order' ? '現品票' : '移動票'} · {record.branchNo === undefined ? '' : `分配${record.branchNo === 0 ? 'なし' : record.branchNo} · `} <time dateTime={record.scannedAt}>{new Date(record.scannedAt).toLocaleString('ja-JP')}</time></p>
        {record.message && <p className="text-sm text-[var(--hp-ng)]">{record.message}</p>}
        {sheet === 'needs_check' && <div className="flex gap-2">
          <button type="button" className={`${hp.mini} !h-11 flex-1`} onClick={() => { void queue.retake(record.clientRecordId).then((retaken) => {
            if (!retaken) return;
            readPlaceSlip(retaken.slipKind === 'purchase_order' ? 'po' : 'mo', '');
            retakeSelection.current = { branchNo: retaken.branchNo, shelfCode: retaken.shelfCode }; setSheet(null);
            mp.setScanField(retaken.slipKind === 'purchase_order' ? 'placePurchaseOrder' : 'transferOrder');
          }); }}>読み直す</button>
          <button type="button" className={`${hp.mini} !h-11 flex-1`} onClick={() => {
            if (confirmDeleteId === record.clientRecordId) { void queue.remove(record.clientRecordId); setConfirmDeleteId(null); }
            else setConfirmDeleteId(record.clientRecordId);
          }}>{confirmDeleteId === record.clientRecordId ? '本当に消す' : '消す'}</button>
        </div>}
      </section>)}
      {(sheet === 'pending' ? queue.pending : queue.needsCheck).length === 0 && <p className={hp.empty}>記録はありません</p>}
    </HaizenSheet>}
    <BarcodeScanModal open={mp.scanField !== null} formats={mp.scanFormats} engine="auto-native" {...KIOSK_STANDARD_BARCODE_SCAN_SESSION}
      onSuccess={(text) => {
        if (tab === 'place' && (mp.scanField === 'transferOrder' || mp.scanField === 'placePurchaseOrder')) {
          readPlaceSlip(mp.scanField === 'placePurchaseOrder' ? 'po' : 'mo', text, retakeSelection.current); mp.setScanField(null);
        } else mp.onScanSuccess(text);
      }} onAbort={() => { retakeSelection.current = null; mp.setScanField(null); }} />
  </div>;
}
