import { useEffect, useRef, useState } from 'react';

import { BarcodeScanModal, KIOSK_STANDARD_BARCODE_SCAN_SESSION } from '../../barcode-scan';
import { MobileOfflineChip } from '../local-data/MobileOfflineChip';
import { useMobileLocalData } from '../local-data/useMobileLocalData';
import { saveScanFrame, onScanIdle, type FrameDetails } from '../scan-frames/saveScanFrame';
import { scanFrameStore, shouldSampleFrame } from '../scan-frames/scanFrameStore';
import { useShelfOfflineQueue } from '../shelfMaster/offline/useShelfOfflineQueue';
import { haizenPhoneColors as colors, haizenPhoneStyle, hp } from '../ui/haizenPhoneTokens';
import { useShelfMachines } from '../useShelfMachines';

import { HaizenBottomNav } from './HaizenBottomNav';
import { HaizenIcon } from './HaizenIcon';
import { HaizenSheet } from './HaizenSheet';
import { HaizenShelfPhotoList, HaizenShelfPhotoPicker } from './HaizenShelfPhotoPicker';
import { HaizenSlipButton } from './HaizenSlipButton';
import { createHaizenClientRecordId } from './offline/haizenOfflineQueueStore';
import { useHaizenOfflineQueue } from './offline/useHaizenOfflineQueue';
import { useHaizenWorkflow } from './useHaizenWorkflow';

import type { HaizenState } from './useHaizenWorkflow';
import type { ScanFrameCapture } from '../../barcode-scan/scanFrameCapture';
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
  const decodedCaptures = useRef<Partial<Record<'transferOrder' | 'placePurchaseOrder', ScanFrameCapture>>>({});
  const timeoutCapture = useRef<{ id: string; field: string | null; details: FrameDetails } | null>(null);
  useEffect(() => {
    if (mp.scanField === 'transferOrder' || mp.scanField === 'placePurchaseOrder') delete decodedCaptures.current[mp.scanField];
    if (mp.scanField !== null) timeoutCapture.current = null;
  }, [mp.scanField]);
  const captureFrame = (capture: ScanFrameCapture) => {
    if (capture.outcome === 'decoded' && (mp.scanField === 'transferOrder' || mp.scanField === 'placePurchaseOrder')) {
      decodedCaptures.current[mp.scanField] = capture;
    }
    if (shouldSampleFrame(capture)) {
      const details: FrameDetails = { kind: 'scan-frame' };
      const id = saveScanFrame(capture, details);
      if (capture.outcome === 'timeout') timeoutCapture.current = { id, field: mp.scanField, details };
    }
  };
  const recordManualValue = (field: string | null, value: string) => {
    if (field === 'transferOrder' || field === 'placePurchaseOrder') delete decodedCaptures.current[field];
    const pending = timeoutCapture.current;
    if (!pending || pending.field !== field) return;
    pending.details.manualValue = value;
    onScanIdle(() => scanFrameStore.updateManualValue(pending.id, value));
  };
  const [placeSlip, setPlaceSlip] = useState<{ kind: 'mo' | 'po'; number: string } | null>(null);
  const [selectedBranchNo, setSelectedBranchNo] = useState<number | null>(null);
  const [branchSelectionVersion, setBranchSelectionVersion] = useState(0);
  const retakeSelection = useRef<{ branchNo?: number; shelfCode: string } | null>(null);
  const [scannedAt, setScannedAt] = useState('');
  const [verifyBranchNo, setVerifyBranchNo] = useState<number | null>(null);
  const [verifyShelfCode, setVerifyShelfCode] = useState('');
  const [verifyScannedAt, setVerifyScannedAt] = useState('');
  const [placeToast, setPlaceToast] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const hasPlaceSlip = Boolean(placeSlip?.number.trim());
  const { setOrderBarcode } = mp;
  const activeNumber = tab === 'verify' ? mp.transferOrder : placeSlip?.number;
  const activeBranchNo = tab === 'verify' ? verifyBranchNo : selectedBranchNo;
  const activeShelfCode = tab === 'verify' ? verifyShelfCode : mp.shelfCode;
  const setActiveBranchNo = tab === 'verify' ? setVerifyBranchNo : setSelectedBranchNo;
  const knownBranches = activeNumber?.trim() && mp.orderBarcode === activeNumber && branches.branchStatus === 'known'
    ? branches.data?.branches : undefined;
  const selectedBranch = knownBranches?.find((branch) => branch.branchNo === activeBranchNo);
  const hasNone = knownBranches?.some((branch) => branch.branchNo === 0) ?? false;
  const hasNumbered = knownBranches?.some((branch) => branch.branchNo > 0) ?? false;
  useEffect(() => {
    if (tab === 'place') setOrderBarcode(placeSlip?.number ?? '');
  }, [tab, placeSlip, setOrderBarcode]);
  useEffect(() => {
    setVerifyScannedAt(mp.transferOrder.trim() ? new Date().toISOString() : '');
  }, [mp.transferOrder]);
  useEffect(() => {
    setVerifyBranchNo(null);
    setVerifyShelfCode('');
  }, [mp.transferOrder, flow.result]);
  useEffect(() => {
    if (!knownBranches || (tab === 'verify' && flow.result !== 'ok')) return;
    const onlyNone = knownBranches.length === 1 && knownBranches[0].branchNo === 0;
    if (activeBranchNo !== null && (activeBranchNo === 0 ? hasNumbered : hasNone)) {
      setActiveBranchNo(onlyNone ? 0 : null);
    } else if (activeBranchNo === null && onlyNone) {
      setActiveBranchNo(0);
    }
  }, [knownBranches, activeBranchNo, setActiveBranchNo, hasNumbered, hasNone, tab, flow.result]);
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
  const put = () => {
    if (!activeNumber?.trim() || activeBranchNo === null || !activeShelfCode.trim() ||
      selectedBranch?.shelfCodeRaw === activeShelfCode || (activeBranchNo === 0 ? hasNumbered : hasNone) ||
      (tab === 'verify' && flow.result !== 'ok')) return;
    const shelf = shelves.data?.shelves.find((s) => s.shelfCodeRaw === activeShelfCode);
    const place = (shelf && [shelf.machineName, shelf.direction, shelf.displayLabel].filter(Boolean).join(' ')) || activeShelfCode;
    const moving = Boolean(selectedBranch);
    // Saved on the phone first; the send continues in the background so a weak link never holds the button.
    const clientRecordId = createHaizenClientRecordId();
    if (tab === 'verify') void mp.linkLastVerifyRecord(clientRecordId).catch(() => console.warn('Verify record could not be linked'));
    const sending = queue.submit({
      clientRecordId, slipKind: tab === 'verify' || placeSlip?.kind === 'mo' ? 'manufacturing_order' : 'purchase_order',
      number: activeNumber, shelfCode: activeShelfCode, scannedAt: tab === 'verify' ? verifyScannedAt : scannedAt, branchNo: activeBranchNo
    });
    const capture = decodedCaptures.current[tab === 'verify' || placeSlip?.kind === 'mo' ? 'transferOrder' : 'placePurchaseOrder'];
    if (capture?.decodedValue?.trim() === activeNumber.trim()) saveScanFrame(capture, {
      kind: 'placement-photo', clientRecordId, shelfCodeRaw: activeShelfCode,
      slipKind: tab === 'verify' || placeSlip?.kind === 'mo' ? 'manufacturing_order' : 'purchase_order'
    });
    if (tab === 'verify') nextVerify();
    else { setPlaceSlip(null); setSelectedBranchNo(null); }
    void sending.then((result) => setPlaceToast(result.status === 'sent' && result.response.action === 'stale'
      ? `${result.response.branchState.shelfCodeRaw}に新しい記録があります`
      : result.status === 'sent'
      ? `${place}に 分配${result.response.branchState.branchNo === 0 ? 'なし' : result.response.branchState.branchNo}を${result.response.action === 'unchanged' ? '確認しました' : result.response.action === 'moved' || (!result.response.action && moving) ? '移しました' : '置きました'}`
      : result.status === 'pending' ? `スマホに保存しました（未送信 ${result.pendingCount}件）` : '要確認に保存しました'), () => setPlaceToast('保存できませんでした'));
  };
  const toast = placeToast || (tab === 'verify' ? flow.toast : null);
  const registerError = tab === 'place' ? null : mp.registerError;

  const previousShelfCodes = selectedBranch ? [selectedBranch.shelfCodeRaw] : [];
  const clearActual = () => {
    mp.setActualOrder(''); mp.setActualFseiban(''); mp.setActualPart('');
    mp.resetSlipResult(); mp.resetActualSlipOcrFeedback();
  };
  const nextVerify = () => {
    clearActual(); mp.setTransferOrder(''); mp.setTransferPart('');
    setVerifyBranchNo(null); setVerifyShelfCode('');
  };
  const change = (setter: (value: string) => void, value: string, actual = false) => {
    setter(value);
    mp.resetSlipResult();
    if (actual) mp.resetActualSlipOcrFeedback();
  };
  const fields = [
    { label: '移動票 製造order', value: mp.transferOrder, set: (value: string) => { if (mp.transferOrder && mp.transferOrder !== value) mp.setTransferPart(''); mp.setTransferOrder(value); }, scan: 'transferOrder', actual: false },
    { label: '現品票 注文番号 / 製造order', value: mp.actualOrder, set: mp.setActualOrder, scan: 'actualOrder', actual: true },
    { label: '移動票 部品番号', value: mp.transferPart, set: mp.setTransferPart, scan: 'transferPart', actual: false },
    { label: '現品票 部品番号', value: mp.actualPart, set: mp.setActualPart, scan: 'actualPart', actual: true },
    { label: '現品票 製番', value: mp.actualFseiban, set: mp.setActualFseiban, scan: null, actual: true }
  ] as const;
  const sameShelf = selectedBranch?.shelfCodeRaw === activeShelfCode;
  const cfg = tab === 'place' || (flow.result === 'ok' && verifyShelfCode.trim())
    ? { label: sameShelf ? '今と同じ棚です' : selectedBranch ? 'ここへ移す' : 'ここに置く', color: colors.shelf, action: () => void put() }
    : flow.result === 'error' ? { label: '再試行', color: colors.actual, action: flow.retry }
    : { label: '次を照合', color: colors.ink, action: nextVerify };
  const primaryLabel = mp.registerSubmitting ? '処理中…' : tab === 'verify' && flow.pending ? '照合中…' : cfg.label;
  const disabled = mp.registerSubmitting || mp.actualSlipImageOcrBusy || (tab === 'verify' && flow.pending) ||
    (tab === 'place' || verifyShelfCode.trim()
      ? !activeNumber?.trim() || activeBranchNo === null || !activeShelfCode.trim() || sameShelf || (activeBranchNo === 0 ? hasNumbered : hasNone)
      : flow.result !== 'ok' && flow.result !== 'error');
  const resultTitle = flow.result === 'ok' ? '一致' : flow.result === 'ng' ? '不一致' : flow.result === 'not-found' ? (mp.slipDetails?.reason === 'part_required' ? 'あと1つ' : '未登録') : '照合できませんでした';
  const resultColor = flow.result === 'ok' ? colors.ok : flow.result === 'ng' ? colors.ng : colors.shelf;

  return <div style={haizenPhoneStyle} className={`fixed inset-0 z-40 flex h-dvh flex-col ${hp.surface} [&_button:focus-visible]:outline [&_button:focus-visible]:outline-2 [&_button:focus-visible]:outline-offset-2 [&_button:focus-visible]:outline-[var(--hp-ink)]`}>
    <div className="relative mx-auto flex min-h-0 w-full max-w-[480px] flex-1 flex-col">
      <main className="relative flex min-h-0 flex-1 flex-col gap-2.5 px-3.5 pt-3.5">
        {tab === 'verify' ? <>
          {localData.offline && <div className="flex shrink-0"><MobileOfflineChip {...localData} /></div>}
          {mp.actualSlipImageOcrBusy && <p role="status" className={hp.muted}>写真を読取中…</p>}
          {mp.actualSlipOcrFeedback.message && <p role="status" className={`text-sm ${hp.muted}`}>{mp.actualSlipOcrFeedback.message}</p>}
          {flow.pending ? <p role="status" aria-label="照合中" className={hp.muted}>照合中…</p> : flow.result === 'ok' ? <>
            <section role="status" aria-label="一致" style={{ color: resultColor, background: `color-mix(in srgb, ${resultColor} 10%, ${colors.bg})` }}
              className="flex shrink-0 items-center gap-2.5 h-12 rounded-[14px] border-2 border-current px-3">
              <span className="flex shrink-0 items-center gap-1.5 text-xl font-black tracking-widest">✓一致</span>
              <div className="min-w-0 flex-1 truncate whitespace-nowrap font-mono text-[15px] font-bold text-[var(--hp-ink)]">
                {mp.slipDetails?.expected?.fseiban} {mp.slipDetails?.expected?.fhincd}{' '}
                <span className={`truncate font-sans text-[12px] ${hp.muted}`}>{mp.slipDetails?.expected?.partName}</span>
              </div>
            </section>
            {mp.slipDetails?.matchedBy === 'part_name' && <p className={`shrink-0 text-sm ${hp.muted}`}>素材 <span className="font-mono">{mp.slipDetails.actual?.partCode}</span> を品名で照合</p>}
          </> : flow.result !== 'idle' && <>
            <section role="status" aria-label={resultTitle} style={{ color: resultColor, background: `color-mix(in srgb, ${resultColor} 10%, ${colors.bg})` }} className="flex h-12 shrink-0 items-center gap-2.5 rounded-[14px] border-2 border-current px-3">
              <span aria-hidden className="shrink-0 text-xl font-black">{flow.result === 'ng' ? '×' : '?'}</span><span className="shrink-0 text-xl font-black">{resultTitle}</span>
              <span className="min-w-0 truncate text-[15px] font-bold text-[var(--hp-ink)]">
                {flow.result === 'ng' ? <><span className="font-mono">{mp.slipDetails?.expected?.fseiban}</span>{' '}{mp.slipDetails?.reason === 'different_seiban' ? '別の製番' : mp.slipDetails?.legacyReason === 'TRANSFER_PART_MISMATCH' ? '移動票の部品番号が違います' : mp.slipDetails?.legacyReason === 'ACTUAL_PART_MISMATCH' ? '現品票の部品番号が違います' : '部品が違います'}</> : flow.result === 'not-found' ? (mp.slipDetails?.reason === 'transfer_not_found' ? 'この製造orderが見つかりません' : mp.slipDetails?.reason === 'part_required' ? '部品番号も読んでください' : 'この注文番号はまだ届いていません') : null}
              </span>
            </section>
            {flow.result === 'not-found' && <div className="flex shrink-0 gap-2"><button type="button" className={`${hp.mini} !h-11 flex-1`} onClick={onPhoto}>写真で製番</button><button type="button" className={`${hp.mini} !h-11 flex-1`} onClick={() => setSheet('inputs')}>部品番号</button></div>}
          </>}
          <section aria-label="棚の写真" className="flex min-h-0 flex-1 flex-col pt-1">
            <HaizenShelfPhotoList key={`${mp.transferOrder}:${verifyBranchNo}:${previousShelfCodes.join()}`} compact shelves={shelves.data?.shelves ?? []} previousShelfCodes={previousShelfCodes}
              loading={shelves.isLoading} error={shelves.isError} onRetry={() => void shelves.refetch()} selected={verifyShelfCode} onSelect={setVerifyShelfCode}
              disabled={flow.result !== 'ok' || verifyBranchNo === null} onScan={() => mp.setScanField('shelf')} onExpand={() => setSheet('shelves')} />
          </section>
        </> : <>
        {(queue.offline || queue.pending.length > 0 || queue.needsCheck.length > 0) && <div aria-label="送信状況" className="flex shrink-0 gap-1.5">
          {queue.offline && <span className={`${hp.chip} inline-flex items-center !text-[var(--hp-ng)]`}>圏外</span>}
          {queue.pending.length > 0 && <button type="button" className={`${hp.chip} !text-orange-400`} onClick={() => setSheet('pending')}>未送信 {queue.pending.length}</button>}
          {queue.needsCheck.length > 0 && <button type="button" className={`${hp.chip} !text-[var(--hp-ng)]`} onClick={() => { setConfirmDeleteId(null); setSheet('needs_check'); }}>要確認 {queue.needsCheck.length}</button>}
        </div>}
        <section aria-label="棚の写真" className="flex min-h-0 flex-1 flex-col pt-1">
          <HaizenShelfPhotoList key={`${placeSlip?.number}:${selectedBranchNo}:${branchSelectionVersion}:${previousShelfCodes.join()}`} compact shelves={shelves.data?.shelves ?? []} previousShelfCodes={previousShelfCodes}
            loading={shelves.isLoading} error={shelves.isError} onRetry={() => void shelves.refetch()} selected={mp.shelfCode} onSelect={mp.selectShelf}
            disabled={!hasPlaceSlip || selectedBranchNo === null} onScan={() => mp.setScanField('shelf')} onExpand={() => setSheet('shelves')}>
            {hasPlaceSlip && branches.branchStatus === 'loading' && <p className={`text-[11px] ${hp.muted}`}>分配一覧を読み込み中…</p>}
          </HaizenShelfPhotoList>
        </section>
        </>}
        {(toast || registerError) && <div role={registerError ? 'alert' : 'status'} className={`absolute bottom-2 left-1/2 z-20 flex max-w-[calc(100%-28px)] -translate-x-1/2 items-center gap-1.5 rounded-2xl bg-[var(--hp-ink)] px-3.5 py-2 text-[14px] font-black ${registerError ? 'text-red-700' : 'text-[var(--hp-bg)]'}`}>
          {!registerError && <HaizenIcon name="check" className="h-[18px] w-[18px] shrink-0" />}<span className="break-words">{registerError || toast}</span>
        </div>}
      </main>
      {(tab === 'place' ? hasPlaceSlip : flow.result === 'ok') && <div className="shrink-0 px-3.5 pt-2">
        <div role="group" aria-label="分配" className="flex h-14 gap-0.5 rounded-2xl border border-[var(--hp-line)] bg-[var(--hp-panel)] p-[3px]">
          {[0, 1, 2, 3, 4, 5].map((branchNo) => <button key={branchNo} type="button" aria-label={branchNo === 0 ? "分配なし" : `分配${branchNo}`} style={{ flex: branchNo === 0 ? 1.7 : 1 }} aria-pressed={activeBranchNo === branchNo}
            disabled={branchNo === 0 ? hasNumbered : hasNone}
            className="min-w-0 whitespace-nowrap rounded-xl text-center font-mono text-xl font-black leading-none aria-pressed:bg-[var(--hp-shelf)] aria-pressed:text-[var(--hp-bg)] disabled:opacity-30 first:font-sans first:text-[17px]"
            onClick={() => { setActiveBranchNo(branchNo); setBranchSelectionVersion((value) => value + 1); }}>
            {branchNo === 0 ? '分配なし' : branchNo}
          </button>)}
        </div>
      </div>}
      <div className="grid shrink-0 h-[80px] grid-cols-3 gap-2 px-3.5 pt-2">
        <HaizenSlipButton onClear={tab === "place" && placeSlip?.kind === "mo" ? () => { setPlaceSlip(null); setSelectedBranchNo(null); } : undefined} label="移動票" color={colors.slip}
          value={tab === 'verify' ? mp.transferOrder : placeSlip?.kind === 'mo' ? placeSlip.number : ''} onClick={() => mp.setScanField('transferOrder')} />
        <HaizenSlipButton onClear={tab === "place" && placeSlip?.kind === "po" ? () => { setPlaceSlip(null); setSelectedBranchNo(null); } : undefined} label="現品票" color={colors.actual}
          value={tab === 'verify' ? mp.actualOrder || mp.actualFseiban : placeSlip?.kind === 'po' ? placeSlip.number : ''}
          disabled={tab === 'verify' && !mp.transferOrder.trim()}
          onClick={() => { if (tab === 'verify') { clearActual(); mp.setScanField('actualOrder'); } else mp.setScanField('placePurchaseOrder'); }} />
        <button type="button" disabled={disabled} style={{ background: cfg.color }}
          className="whitespace-nowrap rounded-2xl px-1 text-xl font-black leading-[1.15] text-[var(--hp-bg)] disabled:opacity-30" onClick={cfg.action}>
          {primaryLabel}
        </button>
      </div>
      <HaizenBottomNav active={tab} onMenu={() => setSheet('menu')} onSelect={(next) => {
        if (next === 'verify' || next === 'place') switchTab(next);
        else onNavigate(next === 'purchase' ? '/kiosk/purchase-order-lookup' : '/kiosk/mobile-placement/part-search');
      }} />
    </div>
    {sheet === 'shelves' && <HaizenShelfPhotoPicker shelves={shelves.data?.shelves ?? []} previousShelfCodes={previousShelfCodes}
      loading={shelves.isLoading} error={shelves.isError} onRetry={() => void shelves.refetch()} selected={activeShelfCode}
      onSelect={(code) => { if (tab === 'verify') setVerifyShelfCode(code); else mp.selectShelf(code); setSheet(null); }} onClose={() => setSheet(null)}
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
          {field.label}<span className="flex gap-2"><input className={`${hp.input} flex-1`} value={field.value} onChange={(e) => { recordManualValue(field.scan, e.target.value); if (tab === 'place') field.set(e.target.value); else change(field.set, e.target.value, field.actual); }} />
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
    <BarcodeScanModal onFrameCaptured={captureFrame} open={mp.scanField !== null} formats={mp.scanFormats} engine="auto-native" {...KIOSK_STANDARD_BARCODE_SCAN_SESSION}
      onSuccess={(text) => {
        if (tab === 'place' && (mp.scanField === 'transferOrder' || mp.scanField === 'placePurchaseOrder')) {
          readPlaceSlip(mp.scanField === 'placePurchaseOrder' ? 'po' : 'mo', text, retakeSelection.current); mp.setScanField(null);
        } else mp.onScanSuccess(text);
      }} onAbort={() => { retakeSelection.current = null; mp.setScanField(null); }} />
  </div>;
}
