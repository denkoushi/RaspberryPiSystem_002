import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

import {
  inventoryThumbnailUrl,
  resolveInventoryTag,
  type InventoryCompartment,
  type InventoryHistoryEntry,
  type InventoryTag,
} from '../../api/client';
import { useInventoryItems, useInventoryMutations } from '../../api/hooks';
import { InventoryPhotoDialog } from '../../components/kiosk/InventoryPhotoDialog';
import { InventoryCorrectionPanel } from '../../features/kiosk/inventory/InventoryCorrectionPanel';
import {
  compartmentLocationText,
  correctionResultMessage,
  pickedCompartmentTag,
} from '../../features/kiosk/inventory/inventoryDailyFlow';
import { InventoryLocationPicker } from '../../features/kiosk/inventory/InventoryLocationPicker';
import { InventoryRecentHistory } from '../../features/kiosk/inventory/InventoryRecentHistory';
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
  const [selectedPhoto, setSelectedPhoto] = useState<{ url: string; alt: string } | null>(null);
  const [panel, setPanel] = useState<'none' | 'correct' | 'pick'>('none');
  const [correctionError, setCorrectionError] = useState<string | null>(null);
  const itemsQuery = useInventoryItems(panel === 'pick');
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
      setMessage(correctionResultMessage(result.transaction.beforeQuantity, result.transaction.afterQuantity));
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

  const locationText = selectedTag?.compartment ? compartmentLocationText(selectedTag.compartment) : null;
  const selectedPhotos = selectedTag?.compartment?.item.photos ?? [];
  const panelClass = messageKind === 'success' ? kioskSuccessPanelClassName : messageKind === 'error' ? kioskErrorPanelClassName : kioskInfoPanelClassName;

  const selectedCompartment = selectedTag?.compartment ?? null;

  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className={kioskPageTitleClassName}>在庫操作</h1>
        {restockMode ? <span className="rounded-full bg-amber-400 px-4 py-2 text-base font-bold text-slate-950">補充モード</span> : null}
        <Link to="/kiosk/inventory/settings" className={`${kioskButtonSecondaryClassName} ml-auto inline-flex items-center`}>在庫の準備</Link>
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
      ) : (
        <div className={`${panelClass} p-5`} role="status" aria-live="polite">
          <p className={messageKind === 'info' ? 'text-center text-2xl font-bold tracking-wide text-white' : 'text-center text-3xl font-bold tracking-wide'}>{message}</p>
          {!selectedCompartment && messageKind === 'info' ? (
            <div className="mt-4 flex flex-wrap justify-center gap-3 text-base text-white/70">
              <span className="rounded-lg bg-slate-950/50 px-4 py-2">持ち出し：アイテムタグ → 数量タグ</span>
              <span className="rounded-lg bg-slate-950/50 px-4 py-2">補充：補充タグ → アイテムタグ → 数量タグ</span>
            </div>
          ) : null}
          {selectedCompartment ? (
            <div className="mt-5 grid gap-5 text-left lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
              <div className="flex flex-wrap content-start gap-2" aria-label="品物写真">
                {selectedPhotos.length === 0 ? <div className="flex h-40 w-full items-center justify-center rounded bg-slate-950/50 text-white/40">写真なし</div> : null}
                {selectedPhotos.map((photo) => <button key={photo.id} type="button" className="shrink-0 rounded focus:outline-none focus:ring-2 focus:ring-sky-300" aria-label={`${photo.originalFilename}を拡大`} onClick={() => setSelectedPhoto({ url: photo.photoUrl, alt: photo.originalFilename })}>
                  <img src={inventoryThumbnailUrl(photo.photoUrl)} alt={photo.originalFilename} className="h-40 w-40 rounded object-cover" />
                </button>)}
              </div>
              <div className="flex min-w-0 flex-col gap-4">
                <div>
                  <p className="text-2xl font-bold text-white">{selectedCompartment.item.name}</p>
                  <p className="text-sm text-white/60">{selectedCompartment.item.itemCode}</p>
                </div>
                <dl className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg bg-slate-950/50 p-3">
                    <dt className="text-sm text-white/60">現在庫</dt>
                    <dd className="text-4xl font-bold text-white">{selectedCompartment.stockQuantity}個</dd>
                  </div>
                  <div className="rounded-lg bg-slate-950/50 p-3">
                    <dt className="text-sm text-white/60">保管場所</dt>
                    <dd className="text-xl font-bold text-white">{locationText}</dd>
                  </div>
                </dl>
                <InventoryRecentHistory compartmentId={selectedCompartment.id} />
                <button type="button" className={`${kioskButtonSecondaryClassName} min-h-14 text-lg`} disabled={busy} onClick={() => { setCorrectionError(null); setPanel('correct'); }}>数が合わないときは直す</button>
              </div>
            </div>
          ) : null}
          {restockTagUid ? <p className="mt-3 text-center text-sm text-white/60">補充タグ: {restockTagUid}</p> : null}
        </div>
      )}
      <InventoryPhotoDialog photoUrl={selectedPhoto?.url ?? null} alt={selectedPhoto?.alt ?? ''} onClose={() => setSelectedPhoto(null)} />
      <div className={`${kioskPanelClassName} flex flex-wrap justify-center gap-3 p-4`}>
        {panel === 'none' ? <button type="button" className={`${kioskButtonSecondaryClassName} min-h-14 text-lg`} onClick={() => setPanel('pick')} disabled={busy}>タグが無いとき：置き場所から選ぶ</button> : null}
        <button type="button" className={`${kioskButtonSecondaryClassName} min-h-14 text-lg`} onClick={reset} disabled={busy}>選択をリセット</button>
        <button type="button" className={`${kioskButtonDangerClassName} min-h-14 text-lg`} onClick={() => void cancelLast()} disabled={!lastTransaction || busy}>直前の取引を取消</button>
      </div>
      <p className="text-center text-xs text-white/50">30秒操作がない場合、選択中のアイテムと補充モードを自動解除します（数の修正中と置き場所を選んでいる間は解除しません）。</p>
    </section>
  );
}
