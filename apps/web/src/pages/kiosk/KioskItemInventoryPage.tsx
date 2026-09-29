import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

import {
  resolveInventoryTag,
  type InventoryCompartment,
  type InventoryHistoryEntry,
  type InventoryTag,
} from '../../api/client';
import { useInventoryItems, useInventoryMutations } from '../../api/hooks';
import { InventoryCorrectionPanel } from '../../features/kiosk/inventory/InventoryCorrectionPanel';
import {
  correctionResultMessage,
  pickedCompartmentTag,
  unitLabel,
} from '../../features/kiosk/inventory/inventoryDailyFlow';
import { InventoryItemGrid } from '../../features/kiosk/inventory/InventoryItemGrid';
import { InventoryLocationBlocks } from '../../features/kiosk/inventory/InventoryLocationBlocks';
import { InventoryLocationPicker } from '../../features/kiosk/inventory/InventoryLocationPicker';
import { InventoryPhotoPane } from '../../features/kiosk/inventory/InventoryPhotoPane';
import { InventoryRecentHistory } from '../../features/kiosk/inventory/InventoryRecentHistory';
import { NfcPrompt } from '../../features/kiosk/inventory/NfcPrompt';
import {
  kioskPageTitleClassName,
} from '../../features/kiosk/kioskTheme';

import type { NfcEvent } from '../../hooks/useNfcStream';

type InventoryRouteState = { inventoryNfcEvent?: NfcEvent };

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
  const prompt = messageKind !== 'info' ? (
    <p role="status" aria-live="polite" className={`inline-flex min-h-[88px] items-center rounded-xl border-2 px-6 text-2xl font-bold ${messageKind === 'success' ? 'border-emerald-400 bg-emerald-900/70 text-white' : 'border-red-400 bg-red-950/70 text-red-100'}`}>{message}</p>
  ) : selectedCompartment && !selectedTag?.uid ? (
    <p role="status" className="inline-flex h-11 items-center rounded-lg border border-white/25 px-3.5 text-base text-white/80">タグなし（確認と数の修正のみ）</p>
  ) : selectedCompartment ? (
    <NfcPrompt label="数量タグ" tone={restockMode ? 'green' : 'amber'} sub={restockMode ? '補充' : undefined} />
  ) : (
    <NfcPrompt label="アイテムタグ" tone={restockMode ? 'green' : 'sky'} sub={restockMode ? '補充' : undefined} />
  );

  const headerButton = 'inline-flex h-11 items-center rounded-lg border border-white/25 bg-slate-800 px-4 text-[15px] font-bold text-white hover:bg-slate-700 disabled:opacity-40';

  return (
    <section className="flex w-full flex-col gap-3.5">
      <div className="flex flex-wrap items-center gap-2.5">
        <h1 className={kioskPageTitleClassName}>在庫操作</h1>
        {restockMode ? <span className="rounded-full bg-emerald-400 px-3 py-1 text-sm font-bold text-slate-950">補充モード</span> : null}
        <span className="flex-1" />
        {panel === 'none' ? <button type="button" className={headerButton} onClick={() => setPanel('pick')} disabled={busy}>置き場所から選ぶ</button> : null}
        <button type="button" className={headerButton} onClick={reset} disabled={busy}>選択をリセット</button>
        <button type="button" className="inline-flex h-11 items-center rounded-lg border border-red-400 px-4 text-[15px] font-bold text-red-100 hover:bg-red-950 disabled:opacity-40" onClick={() => void cancelLast()} disabled={!lastTransaction || busy}>直前の取引を取消</button>
        <span className="w-3" />
        <Link to="/kiosk/inventory/settings" className="inline-flex h-11 items-center rounded-lg border border-white/25 px-4 text-[15px] text-white hover:bg-white/10">在庫の準備</Link>
      </div>

      {panel === 'correct' && selectedCompartment ? (
        <InventoryCorrectionPanel
          compartment={selectedCompartment}
          pending={busy}
          error={correctionError}
          onConfirm={(value) => void submitCorrection(value)}
          onCancel={() => { setPanel('none'); setCorrectionError(null); }}
        />
      ) : panel === 'pick' ? (
        <InventoryLocationPicker
          items={itemsQuery.data ?? []}
          loading={itemsQuery.isLoading}
          onPick={pickCompartment}
          onClose={() => setPanel('none')}
        />
      ) : selectedCompartment ? (
        // Photo pane (left 2/3) and information pane (right 1/3) stay on screen together.
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="h-[calc(100dvh-12rem)] min-h-[24rem]">
            <InventoryPhotoPane key={selectedCompartment.id} photos={selectedPhotos} />
          </div>
          <div className="flex min-w-0 flex-col gap-3">
            <div>{prompt}</div>
            <div>
              <p className="text-2xl font-bold text-white">{selectedCompartment.item.name}</p>
              <p className="text-sm text-white/60">{selectedCompartment.item.itemCode}</p>
            </div>
            <dl className="rounded-lg bg-slate-950/50 px-3.5 py-2.5">
              <dt className="text-sm text-white/60">現在庫</dt>
              <dd className="text-5xl font-bold text-white">{selectedCompartment.stockQuantity}{unitLabel(selectedCompartment.item)}</dd>
            </dl>
            <InventoryLocationBlocks compartment={selectedCompartment} />
            <div className="flex items-start gap-3">
              <InventoryRecentHistory compartmentId={selectedCompartment.id} />
              <button type="button" className="h-12 rounded-lg border border-white/25 bg-slate-800 px-4 text-base font-bold text-white hover:bg-slate-700 disabled:opacity-40" disabled={busy} onClick={() => { setCorrectionError(null); setPanel('correct'); }}>数を直す</button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-4">
            {prompt}
            <div className="flex gap-2 text-sm text-white/60">
              <span className="rounded-lg bg-slate-900/70 px-2.5 py-1.5">持出：アイテム → 数量</span>
              <span className="rounded-lg bg-slate-900/70 px-2.5 py-1.5">補充：補充 → アイテム → 数量</span>
            </div>
            <span className="flex-1" />
            <span className="text-sm text-white/60">登録済み {itemCompartments.length}件</span>
          </div>
          <InventoryItemGrid compartments={itemCompartments} onPick={pickCompartment} />
        </>
      )}
    </section>
  );
}
