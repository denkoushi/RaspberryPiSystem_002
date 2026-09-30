import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import {
  resolveInventoryTag,
  type InventoryCompartment,
  type InventoryHistoryEntry,
  type InventoryTag,
} from '../../api/client';
import { useInventoryImportSummaries, useInventoryItems, useInventoryMutations } from '../../api/hooks';
import { InventoryCorrectionPanel } from '../../features/kiosk/inventory/InventoryCorrectionPanel';
import {
  correctionResultMessage,
  pickedCompartmentTag,
  unitLabel,
} from '../../features/kiosk/inventory/inventoryDailyFlow';
import { BackIcon, EditIcon, GridIcon, LockIcon, ResetIcon, UndoIcon } from '../../features/kiosk/inventory/InventoryIcons';
import { InventoryItemGrid } from '../../features/kiosk/inventory/InventoryItemGrid';
import { InventoryLocationBlocks } from '../../features/kiosk/inventory/InventoryLocationBlocks';
import { InventoryLocationPicker } from '../../features/kiosk/inventory/InventoryLocationPicker';
import { InventoryPhotoPane } from '../../features/kiosk/inventory/InventoryPhotoPane';
import { InventoryRecentHistory } from '../../features/kiosk/inventory/InventoryRecentHistory';
import {
  invButton,
  invButtonDanger,
  invButtonGhost,
  invCard,
  invError,
  invEyebrow,
  invSuccess,
  invSurface,
  invTitle,
} from '../../features/kiosk/inventory/inventoryUi';
import { NfcPrompt } from '../../features/kiosk/inventory/NfcPrompt';

import type { NfcEvent } from '../../hooks/useNfcStream';

type InventoryRouteState = { inventoryNfcEvent?: NfcEvent };

const TOOL_INFO = [
  ['maker', 'メーカー'],
  ['toolName', '工具名'],
  ['workMaterial', '被削材'],
  ['toolSize', '工具寸法'],
  ['model', '型式'],
  ['usage', '用途'],
] as const;

function messageFromError(error: unknown): string {
  if (error && typeof error === 'object' && 'response' in error) {
    const response = (error as { response?: { data?: { message?: string } } }).response;
    if (response?.data?.message) return response.data.message;
  }
  return error instanceof Error ? error.message : '処理に失敗しました';
}

function playInventoryTone(kind: 'success' | 'restock' | 'error') {
  if (typeof window === 'undefined' || !window.AudioContext) return;
  const context = new window.AudioContext();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const frequency = kind === 'success' ? 880 : kind === 'restock' ? 660 : 180;
  oscillator.frequency.value = frequency;
  oscillator.type = kind === 'error' ? 'sawtooth' : 'sine';
  gain.gain.setValueAtTime(0.0001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.18);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.2);
  window.setTimeout(() => { void context.close(); }, 400);
}

export function KioskItemInventoryPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const mutations = useInventoryMutations();
  const routeState = location.state as InventoryRouteState | null;
  const [restockMode, setRestockMode] = useState(false);
  const [selectedTag, setSelectedTag] = useState<InventoryTag | null>(null);
  const [message, setMessage] = useState('アイテムNFCタグを読み取ってください');
  const [messageKind, setMessageKind] = useState<'info' | 'success' | 'error'>('info');
  const [lastTransaction, setLastTransaction] = useState<InventoryHistoryEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<'none' | 'correct' | 'pick'>('none');
  const [correctionError, setCorrectionError] = useState<string | null>(null);
  const itemsQuery = useInventoryItems();
  const pendingQuery = useInventoryImportSummaries();
  const pendingImports = pendingQuery.data ?? [];
  const itemCompartments = useMemo(() => (itemsQuery.data ?? []).flatMap((item) => item.compartments.map((compartment) => ({ ...compartment, item }))), [itemsQuery.data]);
  const flowRef = useRef({ restockMode: false, restockTagUid: null as string | null, selectedTag: null as InventoryTag | null, processing: false });
  const mountedRef = useRef(true);
  const eventQueueRef = useRef<NfcEvent[]>([]);
  const queuedEventKeyRef = useRef<string | null>(null);
  const drainingRef = useRef(false);
  const drainEventsRef = useRef<() => Promise<void>>(async () => undefined);
  const transactionMutateRef = useRef(mutations.transaction.mutateAsync);

  useEffect(() => {
    transactionMutateRef.current = mutations.transaction.mutateAsync;
  }, [mutations.transaction.mutateAsync]);

  const updateDisplayedStock = (transaction: Pick<InventoryHistoryEntry, 'compartmentId' | 'afterQuantity'>) => {
    setSelectedTag((current) => current?.compartment?.id === transaction.compartmentId
      ? { ...current, compartment: { ...current.compartment, stockQuantity: transaction.afterQuantity } }
      : current);
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const reset = () => {
    const flow = flowRef.current;
    flow.restockMode = false;
    flow.restockTagUid = null;
    flow.selectedTag = null;
    setRestockMode(false);
    setSelectedTag(null);
    setPanel('none');
    setCorrectionError(null);
    setMessage('アイテムNFCタグを読み取ってください');
    setMessageKind('info');
  };

  useEffect(() => {
    drainEventsRef.current = async () => {
      if (drainingRef.current) return;
      drainingRef.current = true;
      try {
        while (eventQueueRef.current.length > 0) {
          const event = eventQueueRef.current.shift();
          if (!event) continue;
          let tag: InventoryTag | null;
          try {
            tag = event.inventoryTag ?? await resolveInventoryTag(event.uid);
          } catch (error) {
            if (mountedRef.current) {
              setMessage(messageFromError(error));
              setMessageKind('error');
              playInventoryTone('error');
            }
            continue;
          }
          if (!tag || !mountedRef.current) continue;
          const flow = flowRef.current;
          if (tag.kind === 'RESTOCK') {
            flow.restockMode = true;
            flow.restockTagUid = tag.uid;
            flow.selectedTag = null;
            setRestockMode(true);
            setSelectedTag(null);
            setMessage('補充モードです。アイテムNFCタグを読み取ってください');
            setMessageKind('info');
            continue;
          }
          if (tag.kind === 'ITEM') {
            if (!tag.compartment) {
              setMessage('アイテムNFCタグに区画が割り当てられていません');
              setMessageKind('error');
              playInventoryTone('error');
              continue;
            }
            flow.selectedTag = tag;
            setSelectedTag(tag);
            setMessage(flow.restockMode ? '数量NFCタグを読み取って補充してください' : '数量NFCタグを読み取ってください');
            setMessageKind('info');
            continue;
          }
          if (!flow.selectedTag?.compartment) {
            setMessage('先にアイテムNFCタグを読み取ってください');
            setMessageKind('error');
            playInventoryTone('error');
            continue;
          }
          if (!flow.selectedTag.uid) {
            setMessage('この引き出しにはアイテムタグがないため、数量タグでは操作できません');
            setMessageKind('error');
            playInventoryTone('error');
            continue;
          }
          if (flow.processing) continue;
          flow.processing = true;
          setBusy(true);
          const restock = flow.restockMode;
          try {
            const result = await transactionMutateRef.current({
              itemTagUid: flow.selectedTag.uid,
              quantityTagUid: tag.uid,
              restockTagUid: flow.restockTagUid ?? undefined,
              restock,
              idempotencyKey: `nfc-${event.eventId ?? `${event.uid}-${event.timestamp}`}`,
            });
            setLastTransaction(result.transaction);
            updateDisplayedStock(result.transaction);
            const unit = unitLabel(flow.selectedTag?.compartment?.item);
            setMessage(restock ? `補充しました（${result.transaction.delta}${unit}）` : `払い出しました（${Math.abs(result.transaction.delta)}${unit}）`);
            setMessageKind('success');
            playInventoryTone(restock ? 'restock' : 'success');
            flow.restockMode = false;
            flow.restockTagUid = null;
            flow.selectedTag = null;
            setRestockMode(false);
          } catch (error) {
            setMessage(messageFromError(error));
            setMessageKind('error');
            playInventoryTone('error');
          } finally {
            flow.processing = false;
            setBusy(false);
          }
        }
      } finally {
        drainingRef.current = false;
      }
    };
  });

  useEffect(() => {
    const event = routeState?.inventoryNfcEvent;
    if (!event) return;
    const eventKey = event.eventId != null ? String(event.eventId) : `${event.uid}:${event.timestamp}`;
    if (queuedEventKeyRef.current === eventKey) return;
    queuedEventKeyRef.current = eventKey;
    // A tag read always wins over an open touch panel.
    setPanel('none');
    eventQueueRef.current.push(event);
    void drainEventsRef.current();
  }, [routeState?.inventoryNfcEvent]);

  useEffect(() => {
    // Counting or picking by touch can take a while; do not reset under the worker's hands.
    if (panel !== 'none') return;
    const timer = window.setTimeout(reset, 30000);
    return () => window.clearTimeout(timer);
  }, [restockMode, selectedTag, message, panel]);

  useEffect(() => {
    if (messageKind === 'info') return;
    const timer = window.setTimeout(() => {
      const flow = flowRef.current;
      setMessage(flow.restockMode
        ? '補充モードです。アイテムNFCタグを読み取ってください'
        : flow.selectedTag
          ? '数量NFCタグを読み取ってください'
          : 'アイテムNFCタグを読み取ってください');
      setMessageKind('info');
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [message, messageKind]);

  const cancelLast = async () => {
    if (!lastTransaction || busy) return;
    setBusy(true);
    try {
      const result = await mutations.cancel.mutateAsync(lastTransaction.id);
      updateDisplayedStock(result.transaction);
      setLastTransaction(null);
      setMessage('直前の取引を取り消しました');
      setMessageKind('success');
      playInventoryTone('success');
    } catch (error) {
      setMessage(messageFromError(error));
      setMessageKind('error');
      playInventoryTone('error');
    } finally {
      setBusy(false);
    }
  };

  const pickCompartment = (compartment: InventoryCompartment) => {
    const tag = pickedCompartmentTag(compartment);
    const flow = flowRef.current;
    flow.selectedTag = tag;
    setSelectedTag(tag);
    setPanel('none');
    setMessage(!tag.uid
      ? 'この引き出しにはアイテムタグがありません（確認と数の修正だけできます）'
      : flow.restockMode ? '数量NFCタグを読み取って補充してください' : '数量NFCタグを読み取ってください');
    setMessageKind('info');
  };

  const submitCorrection = async (desiredQuantity: number) => {
    const compartment = selectedTag?.compartment;
    if (!compartment || busy) return;
    setBusy(true);
    setCorrectionError(null);
    try {
      const result = await mutations.correction.mutateAsync({
        compartmentId: compartment.id,
        desiredQuantity,
        expectedBeforeQuantity: compartment.stockQuantity,
      });
      setLastTransaction(result.transaction);
      updateDisplayedStock(result.transaction);
      setPanel('none');
      setMessage(correctionResultMessage(result.transaction.beforeQuantity, result.transaction.afterQuantity, unitLabel(compartment.item)));
      setMessageKind('success');
      playInventoryTone('success');
    } catch (error) {
      setCorrectionError(messageFromError(error));
      playInventoryTone('error');
      const uid = selectedTag?.uid;
      if (uid) {
        // Show the stock another terminal just wrote so the worker can recount against it.
        const latest = await resolveInventoryTag(uid).catch(() => null);
        if (latest?.compartment?.id === compartment.id && mountedRef.current) {
          if (flowRef.current.selectedTag?.compartment?.id === compartment.id) flowRef.current.selectedTag = latest;
          setSelectedTag(latest);
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const selectedPhotos = selectedTag?.compartment?.item.photos ?? [];
  const selectedCompartment = selectedTag?.compartment ?? null;

  // What the worker should do next, as a mark + short word; results replace it for a few seconds.
  const resultBadge = (
    <p role="status" aria-live="polite" className={`inline-flex h-11 items-center rounded-full border-[1.5px] px-5 text-base font-bold ${messageKind === 'success' ? invSuccess : invError}`}>{message}</p>
  );
  const prompt = messageKind !== 'info' ? resultBadge : selectedCompartment && !selectedTag?.uid ? (
    <p role="status" className="inline-flex h-11 items-center rounded-full border border-inv-line2 px-4 text-[15px] text-inv-muted">タグなし（確認と数の修正のみ）</p>
  ) : selectedCompartment ? (
    <NfcPrompt size="small" label="数量タグ" tone={restockMode ? 'green' : 'amber'} sub={restockMode ? '補充' : undefined} />
  ) : (
    <NfcPrompt size="small" label="アイテムタグ" tone={restockMode ? 'green' : 'sky'} sub={restockMode ? '補充' : undefined} />
  );

  // The waiting screen keeps its prompt in the title row so the item cards get the space.
  const waiting = panel !== 'pick' && !selectedCompartment;
  const toolInfo = selectedCompartment ? TOOL_INFO.flatMap(([key, label]) => {
    const value = selectedCompartment.item[key];
    return value ? [{ label, value }] : [];
  }) : [];

  return (
    <section className={invSurface}>
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        {selectedCompartment ? <button type="button" className={invButtonGhost} onClick={reset} disabled={busy}><BackIcon />一覧へ</button> : null}
        <h1 className={invTitle}>在庫操作</h1>
        {restockMode ? <span className="rounded-full bg-inv-green px-3 py-1 text-sm font-black text-inv-green-ink">補充モード</span> : null}
        {waiting ? (
          <>
            <span className="w-2" />
            {prompt}
            <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-inv-line bg-inv-s1 px-2.5 text-xs text-inv-muted"><b className="text-inv-text">持出</b>アイテム → 数量</span>
            <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-inv-line bg-inv-s1 px-2.5 text-xs text-inv-muted"><b className="text-inv-text">補充</b>補充 → アイテム → 数量</span>
          </>
        ) : null}
        <span className="flex-1" />
        {panel === 'none' ? <button type="button" className={invButtonGhost} onClick={() => setPanel('pick')} disabled={busy}><GridIcon />置き場所から選ぶ</button> : null}
        <button type="button" className={invButtonGhost} onClick={reset} disabled={busy}><ResetIcon />選択をリセット</button>
        <button type="button" className={invButtonDanger} onClick={() => void cancelLast()} disabled={!lastTransaction || busy}><UndoIcon />直前の取引を取消</button>
        <span className="mx-1 h-7 w-px bg-inv-line" />
        <Link to="/kiosk/inventory/settings" className={invButton}><LockIcon />在庫の準備</Link>
      </div>

      {panel === 'pick' ? (
        <InventoryLocationPicker
          items={itemsQuery.data ?? []}
          loading={itemsQuery.isLoading}
          onPick={pickCompartment}
          onClose={() => setPanel('none')}
        />
      ) : selectedCompartment ? (
        // Photo pane (left 2/3) and information pane (right 1/3) stay on screen together.
        <div className="relative grid min-h-0 flex-1 grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-5">
          <div className="min-h-[24rem]">
            <InventoryPhotoPane key={selectedCompartment.id} photos={selectedPhotos} />
          </div>
          <div className="flex min-h-0 min-w-0 flex-col gap-4 overflow-y-auto">
            <div>{prompt}</div>
            <div>
              <p className={invEyebrow}>ITEM</p>
              <p className="mt-1 break-all text-[28px] font-black leading-tight">{selectedCompartment.item.name}</p>
              <p className="font-mono text-[13px] text-inv-faint">{selectedCompartment.item.itemCode}</p>
            </div>
            <dl className={`${invCard} flex items-end gap-2.5 px-5 py-4`}>
              <div>
                <dt className={invEyebrow}>在庫</dt>
                <dd aria-label="現在庫" className="flex items-end gap-2.5">
                  <span className="text-8xl font-black leading-[0.95] tracking-[-0.02em] tabular-nums">{selectedCompartment.stockQuantity}</span>
                  <span className="pb-2.5 text-[22px] font-bold text-inv-muted">{unitLabel(selectedCompartment.item)}</span>
                </dd>
              </div>
              <dd className="ml-auto self-center">
                <button type="button" className={invButton} disabled={busy} onClick={() => { setCorrectionError(null); setPanel('correct'); }}><EditIcon />数を直す</button>
              </dd>
            </dl>
            <InventoryLocationBlocks compartment={selectedCompartment} />
            {toolInfo.length > 0 ? (
              <ul className="flex flex-wrap gap-1.5" aria-label="工具情報">
                {toolInfo.map((entry) => (
                  <li key={entry.label} className="rounded-md bg-inv-s3 px-2.5 py-1 text-xs"><span className="text-inv-faint">{entry.label}</span>&nbsp;&nbsp;<span className="break-all">{entry.value}</span></li>
                ))}
              </ul>
            ) : null}
            <InventoryRecentHistory compartmentId={selectedCompartment.id} />
          </div>
          {panel === 'correct' ? (
            // Counting happens over the item screen, so the worker never leaves it.
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded-[18px] bg-[#05080d]/80">
              <InventoryCorrectionPanel
                compartment={selectedCompartment}
                pending={busy}
                error={correctionError}
                onConfirm={(value) => void submitCorrection(value)}
                onCancel={() => { setPanel('none'); setCorrectionError(null); }}
              />
            </div>
          ) : null}
        </div>
      ) : (
        <>
          <p className="flex shrink-0 items-baseline gap-2.5"><span className={invEyebrow}>登録済み</span><span className="font-black tabular-nums">{itemCompartments.length}</span><span className="text-[13px] text-inv-faint">件 ・ 最近持ち出した順</span>
            {pendingImports.length > 0 ? <><span className={`${invEyebrow} ml-3 text-inv-amber`}>未登録</span><span className="font-black tabular-nums text-inv-amber">{pendingImports.length}</span><span className="text-[13px] text-inv-faint">件</span></> : null}
          </p>
          <InventoryItemGrid
            compartments={itemCompartments}
            onPick={pickCompartment}
            pending={pendingImports}
            onPickPending={(candidate) => navigate('/kiosk/inventory/settings', { state: { importId: candidate.id } })}
          />
        </>
      )}
    </section>
  );
}
