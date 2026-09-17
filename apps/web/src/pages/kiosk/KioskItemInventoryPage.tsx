import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';

import {
  inventoryThumbnailUrl,
  resolveInventoryTag,
  type InventoryHistoryEntry,
  type InventoryTag,
} from '../../api/client';
import { useInventoryMutations } from '../../api/hooks';
import {
  kioskButtonDangerClassName,
  kioskButtonSecondaryClassName,
  kioskErrorPanelClassName,
  kioskInfoPanelClassName,
  kioskPageTitleClassName,
  kioskPanelClassName,
  kioskSuccessPanelClassName,
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
  const [restockTagUid, setRestockTagUid] = useState<string | null>(null);
  const [selectedTag, setSelectedTag] = useState<InventoryTag | null>(null);
  const [message, setMessage] = useState('アイテムNFCタグを読み取ってください');
  const [messageKind, setMessageKind] = useState<'info' | 'success' | 'error'>('info');
  const [lastTransaction, setLastTransaction] = useState<InventoryHistoryEntry | null>(null);
  const [busy, setBusy] = useState(false);
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
    setRestockTagUid(null);
    setSelectedTag(null);
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
            setRestockTagUid(tag.uid);
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
            setMessage(restock ? `補充しました（${result.transaction.delta}個）` : `払い出しました（${Math.abs(result.transaction.delta)}個）`);
            setMessageKind('success');
            playInventoryTone(restock ? 'restock' : 'success');
            flow.restockMode = false;
            flow.restockTagUid = null;
            flow.selectedTag = null;
            setRestockMode(false);
            setRestockTagUid(null);
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
    eventQueueRef.current.push(event);
    void drainEventsRef.current();
  }, [routeState?.inventoryNfcEvent]);

  useEffect(() => {
    const timer = window.setTimeout(reset, 30000);
    return () => window.clearTimeout(timer);
  }, [restockMode, selectedTag, message]);

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

  const locationText = selectedTag?.compartment
    ? `${selectedTag.compartment.area} / 棚${selectedTag.compartment.shelfNumber} / 引出し${selectedTag.compartment.drawerNumber}`
    : null;
  const selectedPhotos = selectedTag?.compartment?.item.photos ?? [];
  const panelClass = messageKind === 'success' ? kioskSuccessPanelClassName : messageKind === 'error' ? kioskErrorPanelClassName : kioskInfoPanelClassName;

  return (
    <section className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className={kioskPageTitleClassName}>在庫操作</h1>
        {restockMode ? <span className="rounded-full bg-amber-400 px-4 py-2 text-base font-bold text-slate-950">補充モード</span> : null}
      </div>
      <div className={`${panelClass} min-h-48 p-8 text-center`} role="status" aria-live="polite">
        <p className="text-3xl font-black tracking-wide">{message}</p>
        {selectedTag?.compartment ? (
          <p className="mt-5 text-xl text-white/80">
            {selectedTag.compartment.item.name}{' '}現在庫 {selectedTag.compartment.stockQuantity}個
            {locationText ? ` (${locationText})` : ''}
          </p>
        ) : null}
        {selectedPhotos.length > 0 ? <div className="mx-auto mt-4 flex w-full max-w-full justify-start gap-2 overflow-x-auto" aria-label="品物写真">
          {selectedPhotos.map((photo) => <img key={photo.id} src={inventoryThumbnailUrl(photo.photoUrl)} alt={photo.originalFilename} className="h-24 w-24 shrink-0 rounded object-cover" />)}
        </div> : null}
        {restockTagUid ? <p className="mt-3 text-sm text-white/60">補充タグ: {restockTagUid}</p> : null}
      </div>
      <div className={`${kioskPanelClassName} flex flex-wrap justify-center gap-3 p-4`}>
        <button type="button" className={kioskButtonSecondaryClassName} onClick={reset} disabled={busy}>選択をリセット</button>
        <button type="button" className={kioskButtonDangerClassName} onClick={() => void cancelLast()} disabled={!lastTransaction || busy}>直前の取引を取消</button>
      </div>
      <p className="text-center text-sm text-white/60">30秒操作がない場合、選択中のアイテムと補充モードを自動解除します。</p>
    </section>
  );
}
