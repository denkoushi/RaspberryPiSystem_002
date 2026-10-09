import { formatInventoryLabelNumber } from '@raspi-system/shared-types';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import {
  resolveInventoryTag,
  resolveInventoryLabelNumber,
  type InventoryCompartment,
  type InventoryMovementTransaction,
  type InventoryImportSummary,
  type InventoryTag,
} from '../../api/client';
import { useInventoryImportSummaries, useInventoryItems, useInventoryMutations } from '../../api/hooks';
import { KioskHomeIcon } from '../../components/kiosk/KioskHomeIcon';
import { InventoryCorrectionPanel } from '../../features/kiosk/inventory/InventoryCorrectionPanel';
import {
  correctionResultMessage,
  formatSignedDelta,
  pickedCompartmentTag,
  unitLabel,
} from '../../features/kiosk/inventory/inventoryDailyFlow';
import { BackIcon, EditIcon, LockIcon, UndoIcon } from '../../features/kiosk/inventory/InventoryIcons';
import { InventoryItemGrid, type InventoryThumbnailSize } from '../../features/kiosk/inventory/InventoryItemGrid';
import { InventoryPhotoPane } from '../../features/kiosk/inventory/InventoryPhotoPane';
import { InventoryQuantityPanel } from '../../features/kiosk/inventory/InventoryQuantityPanel';
import { InventoryRecentHistory } from '../../features/kiosk/inventory/InventoryRecentHistory';
import {
  invLabelNumber,
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

function messageFromError(error: unknown): string {
  if (error && typeof error === 'object' && 'response' in error) {
    const response = (error as { response?: { data?: { message?: string } } }).response;
    if (response?.data?.message) return response.data.message;
  }
  return error instanceof Error ? error.message : '処理に失敗しました';
}

function isClientError(error: unknown): boolean {
  const status = (error as { response?: { status?: number } })?.response?.status;
  return status !== undefined && status >= 400 && status < 500;
}

const thumbnailSizeKey = 'kiosk-inventory-thumbnail-size';
const defaultAreaKey = 'kiosk-inventory-default-area';
function readDefaultArea(): string | null {
  try { return localStorage.getItem(defaultAreaKey)?.trim() || null; } catch { return null; }
}
const EMPTY_IMPORTS: InventoryImportSummary[] = [];
let inventoryAudioContext: AudioContext | null = null;

function playInventoryTone(kind: 'success' | 'restock' | 'error') {
  if (typeof window === 'undefined' || !window.AudioContext) return;
  const context = inventoryAudioContext ??= new window.AudioContext();
  if (context.state === 'suspended') void context.resume();
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
}

// Scans read during a failed operation are dropped even when they arrive after this page was left and reopened.
let failedOperationAt = -Infinity;

export function KioskItemInventoryPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const mutations = useInventoryMutations();
  const queryClient = useQueryClient();
  const routeState = location.state as InventoryRouteState | null;
  const [numberOpen, setNumberOpen] = useState(false);
  const [numberInput, setNumberInput] = useState('');
  const [numberError, setNumberError] = useState<string | null>(null);
  const [numberBusy, setNumberBusy] = useState(false);
  const numberLookupRef = useRef(0);
  const [restockMode, setRestockMode] = useState(false);
  const [selectedTag, setSelectedTag] = useState<InventoryTag | null>(null);
  const [message, setMessage] = useState('アイテムNFCタグを読み取ってください');
  const [messageKind, setMessageKind] = useState<'info' | 'success' | 'error'>('info');
  const [lastTransaction, setLastTransaction] = useState<InventoryMovementTransaction | null>(null);
  const [lastTransactionUnit, setLastTransactionUnit] = useState('個');
  const [resultTransaction, setResultTransaction] = useState<InventoryMovementTransaction | null>(null);
  const [activity, setActivity] = useState(0);
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<'none' | 'correct' | 'quantity'>('none');
  const [quantityError, setQuantityError] = useState<string | null>(null);
  const [savedArea, setSavedArea] = useState<string | null>(readDefaultArea);
  const [areaFilter, setAreaFilter] = useState<string | null>(readDefaultArea);
  const [thumbnailSize, setThumbnailSize] = useState<InventoryThumbnailSize>(() => {
    try { const saved = localStorage.getItem(thumbnailSizeKey); if (saved === 'small' || saved === 'medium' || saved === 'large') return saved; } catch { /* Storage is optional. */ }
    return 'medium';
  });
  const [areaNotice, setAreaNotice] = useState<{ message: string; undo?: { area: string | null } } | null>(null);
  useEffect(() => {
    if (!areaNotice) return;
    const timer = window.setTimeout(() => setAreaNotice(null), areaNotice.undo ? 6000 : 3000);
    return () => window.clearTimeout(timer);
  }, [areaNotice]);
  const changeSize = (size: InventoryThumbnailSize) => {
    setThumbnailSize(size);
    try { localStorage.setItem(thumbnailSizeKey, size); } catch { /* Keep the in-memory choice. */ }
  };
  const saveArea = (area: string | null, undo = false) => {
    try {
      if (area === null) localStorage.removeItem(defaultAreaKey);
      else localStorage.setItem(defaultAreaKey, area);
      setSavedArea(area);
      setAreaNotice(undo ? { message: '最初の表示を元に戻しました' } : { message: `この端末は最初に「${area ?? 'すべて'}」を表示します`, undo: { area: savedArea } });
    } catch { setAreaNotice({ message: '最初の表示を保存できませんでした' }); }
  };
  const [shelfFilter, setShelfFilter] = useState<number | null>(null);
  const [refreshingTag, setRefreshingTag] = useState(false);
  const [correctionError, setCorrectionError] = useState<string | null>(null);
  const itemsQuery = useInventoryItems();
  const pendingQuery = useInventoryImportSummaries();
  const pendingImports = pendingQuery.data ?? EMPTY_IMPORTS;
  const itemCompartments = useMemo(() => (itemsQuery.data ?? []).flatMap((item) => item.compartments.map((compartment) => ({ ...compartment, item }))), [itemsQuery.data]);
  const areas = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of itemCompartments) counts.set(entry.area, (counts.get(entry.area) ?? 0) + 1);
    return [...counts].map(([area, count]) => ({ area, count }));
  }, [itemCompartments]);
  const effectiveArea = itemsQuery.data && !itemsQuery.isLoading && !areas.some((entry) => entry.area === areaFilter) ? null : areaFilter;
  const defaultArea = areas.some((entry) => entry.area === savedArea) ? savedArea : null;
  const isDefaultArea = effectiveArea === defaultArea;
  const homeLabel = isDefaultArea ? 'このエリアが最初の表示です' : 'このエリアを最初の表示にする';
  const inArea = useMemo(() => itemCompartments.filter((entry) => effectiveArea === null || entry.area === effectiveArea), [itemCompartments, effectiveArea]);
  const shelves = useMemo(() => [...new Set(inArea.map((entry) => entry.shelfNumber))].sort((a, b) => a - b), [inArea]);
  const filteredCompartments = useMemo(() => inArea.filter((entry) => shelfFilter === null || entry.shelfNumber === shelfFilter), [inArea, shelfFilter]);
  const flowRef = useRef({ restockMode: false, restockTagUid: null as string | null, selectedTag: null as InventoryTag | null, processing: false });
  const mountedRef = useRef(true);
  const verificationGenerationRef = useRef(0);
  const selectedTagRef = useRef<InventoryTag | null>(null);
  const selectionVerificationRef = useRef<Promise<boolean> | null>(null);
  const eventQueueRef = useRef<NfcEvent[]>([]);
  const queuedEventKeyRef = useRef<string | null>(null);
  const drainingRef = useRef(false);
  const drainEventsRef = useRef<() => Promise<void>>(async () => undefined);
  const selectTag = useCallback((tag: InventoryTag | null) => {
    const current = selectedTagRef.current;
    if (current?.uid !== tag?.uid || current?.compartment?.id !== tag?.compartment?.id) {
      verificationGenerationRef.current += 1;
      selectionVerificationRef.current = null;
      setRefreshingTag(false);
    }
    setNumberOpen(false);
    numberLookupRef.current += 1;
    selectedTagRef.current = tag;
    flowRef.current.selectedTag = tag;
    setSelectedTag(tag);
  }, []);

  const refreshDisplayedStock = async () => {
    const id = selectedTagRef.current?.compartment?.id;
    const refreshed = await itemsQuery.refetch().catch(() => null);
    const item = refreshed?.data?.find((entry) => entry.compartments.some((drawer) => drawer.id === id));
    const drawer = item?.compartments.find((entry) => entry.id === id);
    if (item && drawer && mountedRef.current) selectTag(pickedCompartmentTag({ ...drawer, item }));
  };

  const applyTransactionStock = async (transaction: InventoryMovementTransaction) => {
    let tag = selectedTagRef.current;
    if (tag?.compartment?.id !== transaction.compartmentId) {
      const findTag = (items: typeof itemsQuery.data) => {
        const item = items?.find((entry) => entry.compartments.some((drawer) => drawer.id === transaction.compartmentId));
        const drawer = item?.compartments.find((entry) => entry.id === transaction.compartmentId);
        return item && drawer ? pickedCompartmentTag({ ...drawer, item }) : null;
      };
      tag = findTag(queryClient.getQueryData(['inventory-items']) ?? itemsQuery.data);
      if (!tag) tag = findTag((await itemsQuery.refetch().catch(() => null))?.data);
    }
    if (tag?.compartment) tag = { ...tag, compartment: { ...tag.compartment, stockQuantity: transaction.afterQuantity } };
    selectTag(tag);
    return unitLabel(tag?.compartment?.item);
  };

  // All stock writes hold this lock, including the wait for the selected ITEM verification.
  const runOperation = async (operation: () => Promise<boolean>, onError: (error: unknown) => Promise<void> | void) => {
    const flow = flowRef.current;
    if (flow.processing) return;
    flow.processing = true;
    setBusy(true);
    let succeeded = false;
    try {
      const generation = verificationGenerationRef.current;
      const verification = selectionVerificationRef.current;
      if (verification && !await verification) return;
      if (!mountedRef.current || generation !== verificationGenerationRef.current) return;
      succeeded = await operation();
    } catch (error) {
      if (isClientError(error)) void queryClient.invalidateQueries({ queryKey: ['inventory-tags'] });
      await onError(error);
    } finally {
      if (!succeeded) {
        failedOperationAt = performance.now();
        eventQueueRef.current = [];
      }
      flow.processing = false;
      setBusy(false);
      void drainEventsRef.current();
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const reset = useCallback(() => {
    selectTag(null);
    const flow = flowRef.current;
    flow.restockMode = false;
    flow.restockTagUid = null;
    setRestockMode(false);
    setLastTransaction(null);
    setResultTransaction(null);
    setPanel('none');
    setCorrectionError(null);
    setQuantityError(null);
    setMessage('アイテムNFCタグを読み取ってください');
    setMessageKind('info');
  }, [selectTag]);

  const completeMovement = async (transaction: InventoryMovementTransaction, restock: boolean) => {
    const unit = await applyTransactionStock(transaction);
    setLastTransaction(transaction);
    setResultTransaction(transaction);
    setLastTransactionUnit(unit);
    setMessage(restock ? `補充しました（${transaction.delta}${unit}）` : `払い出しました（${Math.abs(transaction.delta)}${unit}）`);
    setMessageKind('success');
    setQuantityError(null);
    playInventoryTone(restock ? 'restock' : 'success');
    const flow = flowRef.current;
    flow.restockMode = false;
    flow.restockTagUid = null;
    setRestockMode(false);
  };

  const handleTouchError = async (error: unknown) => {
    const data = (error as { response?: { data?: { code?: string; errorCode?: string } } })?.response?.data;
    const code = data?.errorCode ?? data?.code;
    const uncertain = !isClientError(error);
    setQuantityError(uncertain ? '通信できませんでした。在庫数を確かめてください'
      : code === 'INVENTORY_INSUFFICIENT_STOCK' ? '在庫が足りません'
        : code === 'INVENTORY_CONFLICT' ? '数が変わりました' : messageFromError(error));
    playInventoryTone('error');
    if (uncertain || code === 'INVENTORY_CONFLICT') await refreshDisplayedStock();
  };

  useEffect(() => {
    drainEventsRef.current = async () => {
      if (drainingRef.current || flowRef.current.processing) return;
      drainingRef.current = true;
      try {
        while (eventQueueRef.current.length > 0 && !flowRef.current.processing) {
          const event = eventQueueRef.current[0];
          if (!event) continue;
          let tag: InventoryTag | null;
          try {
            tag = event.inventoryTag ?? await resolveInventoryTag(event.uid);
          } catch (error) {
            if (eventQueueRef.current[0] !== event) continue;
            eventQueueRef.current.shift();
            if (isClientError(error)) void queryClient.invalidateQueries({ queryKey: ['inventory-tags'] });
            setMessage(messageFromError(error));
            setMessageKind('error');
            playInventoryTone('error');
            continue;
          }
          if (!mountedRef.current) return;
          if (eventQueueRef.current[0] !== event) continue;
          // A touch operation may have acquired the lock during an uncached lookup.
          if (flowRef.current.processing) {
            eventQueueRef.current[0] = { ...event, inventoryTag: tag ?? undefined };
            break;
          }
          eventQueueRef.current.shift();
          if (!tag) continue;
          const flow = flowRef.current;
          setPanel('none');
          if (tag.kind === 'RESTOCK') {
            selectTag(null);
            flow.restockMode = true;
            flow.restockTagUid = tag.uid;
            setRestockMode(true);
            setMessage('補充モードです。アイテムNFCタグを読み取ってください');
            setMessageKind('info');
            continue;
          }
          if (tag.kind === 'ITEM') {
            if (!tag.compartment) {
              selectTag(null);
              if (event.inventoryTagFromCache) void queryClient.invalidateQueries({ queryKey: ['inventory-tags'] });
              setMessage('アイテムNFCタグに区画が割り当てられていません');
              setMessageKind('error');
              playInventoryTone('error');
              continue;
            }
            selectTag(tag);
            setQuantityError(null);
            setLastTransaction((current) => current?.compartmentId === tag.compartment?.id ? current : null);
            setMessage(flow.restockMode ? '数量NFCタグを読み取って補充してください' : '数量NFCタグを読み取ってください');
            setMessageKind('info');
            if ((event.inventoryTagFromCache || event.inventoryTagNeedsRefresh) && !selectionVerificationRef.current) {
              const cachedTag = tag;
              const generation = verificationGenerationRef.current;
              setRefreshingTag(Boolean(event.inventoryTagNeedsRefresh));
              const verification = resolveInventoryTag(event.uid).then((latest) => {
                if (!mountedRef.current || generation !== verificationGenerationRef.current) return false;
                const unchanged = latest?.kind === 'ITEM' && Boolean(latest.compartment) && latest.compartment?.id === cachedTag.compartment?.id;
                selectTag(latest?.kind === 'ITEM' && latest.compartment ? latest : null);
                setLastTransaction((current) => current?.compartmentId === latest?.compartment?.id ? current : null);
                if (!unchanged) {
                  void queryClient.invalidateQueries({ queryKey: ['inventory-tags'] });
                  setPanel('none');
                  setQuantityError(null);
                  setCorrectionError(null);
                  if (!latest || latest.kind !== 'ITEM' || !latest.compartment) {
                    setMessage('タグの登録が変わりました');
                    setMessageKind('error');
                    playInventoryTone('error');
                  }
                }
                return unchanged;
              }).catch(() => {
                if (!mountedRef.current || generation !== verificationGenerationRef.current) return false;
                if (!Number.isFinite(cachedTag.compartment!.stockQuantity)) {
                  selectTag(null);
                  setMessage('通信できませんでした');
                  setMessageKind('error');
                  playInventoryTone('error');
                  return false;
                }
                return true;
              }).finally(() => {
                if (selectionVerificationRef.current === verification) selectionVerificationRef.current = null;
                if (mountedRef.current && generation === verificationGenerationRef.current) setRefreshingTag(false);
              });
              selectionVerificationRef.current = verification;
            }
            continue;
          }
          let touchRoute = false;
          await runOperation(async () => {
            const generation = verificationGenerationRef.current;
            const selected = flow.selectedTag;
            const compartment = selected?.compartment;
            if (!compartment || !Number.isFinite(compartment.stockQuantity)) {
              setMessage('先にアイテムNFCタグを読み取ってください');
              setMessageKind('error');
              playInventoryTone('error');
              return false;
            }
            const restock = flow.restockMode;
            touchRoute = !selected.uid || (restock && !flow.restockTagUid);
            const idempotencyKey = `nfc-${event.eventId ?? `${event.uid}-${event.timestamp}`}`;
            let result;
            if (touchRoute) {
              const latestQuantity = await resolveInventoryTag(tag.uid);
              if (!mountedRef.current || generation !== verificationGenerationRef.current) return false;
              if (latestQuantity?.kind !== 'QUANTITY' || !latestQuantity.quantity || latestQuantity.quantity <= 0) {
                void queryClient.invalidateQueries({ queryKey: ['inventory-tags'] });
                setMessage('タグの登録が変わりました');
                setMessageKind('error');
                return false;
              }
              result = await mutations.touchTransaction.mutateAsync({
                compartmentId: compartment.id, quantity: latestQuantity.quantity, restock,
                expectedBeforeQuantity: compartment.stockQuantity, idempotencyKey,
              });
            } else {
              result = await mutations.transaction.mutateAsync({
                itemTagUid: selected.uid, expectedCompartmentId: compartment.id, quantityTagUid: tag.uid,
                restockTagUid: flow.restockTagUid ?? undefined, restock, idempotencyKey,
              });
            }
            await completeMovement(result.transaction, restock);
            return true;
          }, async (error) => {
            if (touchRoute) await handleTouchError(error);
            else {
              const response = (error as { response?: { status?: number; data?: { code?: string; errorCode?: string } } })?.response;
              if (response?.status === 409 && (response.data?.errorCode ?? response.data?.code) === 'INVENTORY_CONFLICT') {
                selectTag(null);
                void queryClient.invalidateQueries({ queryKey: ['inventory-tags'] });
                void queryClient.invalidateQueries({ queryKey: ['inventory-items'] });
                setMessage('タグの登録が変わりました');
              } else setMessage(messageFromError(error));
              setMessageKind('error');
              playInventoryTone('error');
            }
          });
        }
      } finally {
        drainingRef.current = false;
      }
    };
  });

  useEffect(() => {
    const event = routeState?.inventoryNfcEvent;
    if (!event) return;
    if (event.receivedAt !== undefined && event.receivedAt <= failedOperationAt) return;
    const eventKey = event.eventId != null ? String(event.eventId) : `${event.uid}:${event.timestamp}`;
    if (queuedEventKeyRef.current === eventKey) return;
    queuedEventKeyRef.current = eventKey;
    eventQueueRef.current.push(event);
    void drainEventsRef.current();
  }, [routeState?.inventoryNfcEvent]);

  useEffect(() => {
    // Counting or picking by touch can take a while; do not reset under the worker's hands.
    if (panel !== 'none' || busy || refreshingTag || numberOpen) return;
    const timer = window.setTimeout(reset, 30000);
    return () => window.clearTimeout(timer);
  }, [restockMode, selectedTag, message, panel, activity, reset, busy, refreshingTag, numberOpen]);

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
    if (!lastTransaction) return;
    const transactionId = lastTransaction.id;
    await runOperation(async () => {
      const result = await mutations.cancel.mutateAsync(transactionId);
      await applyTransactionStock(result.transaction);
      setResultTransaction(result.transaction);
      setLastTransaction((current) => current?.id === transactionId ? null : current);
      setMessage('直前の取引を取り消しました');
      setMessageKind('success');
      playInventoryTone('success');
      return true;
    }, (error) => {
      setMessage(messageFromError(error));
      setMessageKind('error');
      playInventoryTone('error');
    });
  };

  const pickCompartment = useCallback((compartment: InventoryCompartment) => {
    if (flowRef.current.processing) return;
    selectTag(pickedCompartmentTag(compartment));
    setLastTransaction((current) => current?.compartmentId === compartment.id ? current : null);
    setPanel('none');
    setQuantityError(null);
    setMessage('数を押す か 数量タグ');
    setMessageKind('info');
  }, [selectTag]);
  const openNumber = async () => {
    if (numberBusy || !numberInput || flowRef.current.processing) return;
    const generation = ++numberLookupRef.current;
    setNumberBusy(true);
    setNumberError(null);
    try {
      const tag = await resolveInventoryLabelNumber(numberInput);
      if (!mountedRef.current || generation !== numberLookupRef.current) return;
      if (!tag?.compartment) { setNumberError('この番号の品物はありません'); return; }
      // Feed the resolved ITEM through exactly the same queue as an item-tag scan.
      eventQueueRef.current.push({ uid: tag.uid, timestamp: new Date().toISOString(), inventoryTag: tag });
      await drainEventsRef.current();
    } catch (error) {
      if (mountedRef.current && generation === numberLookupRef.current) setNumberError((error as { response?: { status?: number } })?.response?.status === 404 ? 'この番号の品物はありません' : '通信できませんでした');
    } finally { if (mountedRef.current) setNumberBusy(false); }
  };
  const pickPending = useCallback((candidate: InventoryImportSummary) => navigate('/kiosk/inventory/settings', { state: { importId: candidate.id } }), [navigate]);

  const submitCorrection = async (desiredQuantity: number) => {
    const transactionId = lastTransaction?.id;
    setCorrectionError(null);
    await runOperation(async () => {
      const compartment = selectedTagRef.current?.compartment;
      if (!compartment || !Number.isFinite(compartment.stockQuantity)) return false;
      const result = await mutations.correction.mutateAsync({
        compartmentId: compartment.id, desiredQuantity, expectedBeforeQuantity: compartment.stockQuantity,
      });
      const unit = await applyTransactionStock(result.transaction);
      setLastTransaction((current) => current?.id === transactionId ? result.transaction : current);
      setLastTransactionUnit(unit);
      setResultTransaction(result.transaction);
      setPanel('none');
      setMessage(correctionResultMessage(result.transaction.beforeQuantity, result.transaction.afterQuantity, unit));
      setMessageKind('success');
      playInventoryTone('success');
      return true;
    }, async (error) => {
      setCorrectionError(messageFromError(error));
      playInventoryTone('error');
      const tag = selectedTagRef.current;
      if (tag?.uid) {
        const latest = await resolveInventoryTag(tag.uid).catch(() => null);
        if (latest?.compartment?.id === tag.compartment?.id && mountedRef.current) selectTag(latest);
      } else await refreshDisplayedStock();
    });
  };

  const switchMode = (restock: boolean) => {
    if (flowRef.current.processing || refreshingTag) return;
    flowRef.current.restockMode = restock;
    flowRef.current.restockTagUid = null;
    setRestockMode(restock);
    setQuantityError(null);
  };

  const submitQuantity = async (quantity: number) => {
    setQuantityError(null);
    await runOperation(async () => {
      const compartment = selectedTagRef.current?.compartment;
      if (!compartment || !Number.isFinite(compartment.stockQuantity)) return false;
      const restock = flowRef.current.restockMode;
      const result = await mutations.touchTransaction.mutateAsync({
        compartmentId: compartment.id, quantity, restock,
        expectedBeforeQuantity: compartment.stockQuantity, idempotencyKey: crypto.randomUUID(),
      });
      await completeMovement(result.transaction, restock);
      setPanel('none');
      return true;
    }, handleTouchError);
  };

  const selectedPhotos = selectedTag?.compartment?.item.photos ?? [];
  const selectedCompartment = selectedTag?.compartment ?? null;
  const lastTransactionItemName = lastTransaction?.inventoryItem?.name
    ?? (selectedCompartment?.id === lastTransaction?.compartmentId ? selectedCompartment?.item.name : undefined)
    ?? itemCompartments.find((entry) => entry.id === lastTransaction?.compartmentId)?.item.name;

  // What the worker should do next, as a mark + short word; results replace it for a few seconds.
  const resultBadge = (
    <p role="status" aria-live="polite" className={`inline-flex h-11 items-center rounded-full border-[1.5px] px-5 text-base font-bold ${messageKind === 'success' ? invSuccess : invError}`}>{message}</p>
  );
  const prompt = messageKind !== 'info' ? resultBadge : selectedTag?.compartment ? (
    <NfcPrompt size="small" label="数を押す か 数量タグ" tone={restockMode ? 'green' : 'amber'} />
  ) : (
    <NfcPrompt size="small" label="アイテムタグ" tone={restockMode ? 'green' : 'sky'} sub={restockMode ? '補充' : undefined} />
  );
  const chipClass = (selected: boolean) => `inline-flex h-11 items-center gap-1.5 rounded-full border px-4 text-base font-bold ${selected ? 'border-inv-cyan bg-inv-cyan text-inv-cyan-ink' : 'border-inv-line2 bg-inv-s1'}`;

  return (
    <section className={`${invSurface} relative`} onPointerDownCapture={() => setActivity((current) => current + 1)} onClickCapture={() => setActivity((current) => current + 1)} onKeyDownCapture={() => setActivity((current) => current + 1)}>
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        {selectedCompartment ? <button type="button" className={`${invButtonGhost} h-12 rounded-xl`} onClick={reset} disabled={busy || refreshingTag}><BackIcon />一覧へ</button> : null}
        <h1 className={invTitle}>在庫操作</h1>
        {prompt}
        <span className="flex-1" />
        <div role="group" aria-label="払い出しか補充か" className="inline-flex overflow-hidden rounded-xl border border-inv-line2">
          <button type="button" aria-pressed={!restockMode} disabled={busy || refreshingTag} onClick={() => switchMode(false)} className={`h-12 px-[18px] font-bold disabled:opacity-40 ${!restockMode ? 'bg-inv-amber text-inv-amber-ink' : 'text-inv-muted'}`}>払い出し</button>
          <button type="button" aria-pressed={restockMode} disabled={busy || refreshingTag} onClick={() => switchMode(true)} className={`h-12 px-[18px] font-bold disabled:opacity-40 ${restockMode ? 'bg-inv-green text-inv-green-ink' : 'text-inv-muted'}`}>補充</button>
        </div>
        {lastTransaction ? <button type="button" className={`${invButtonDanger} h-12 max-w-[340px] border-inv-red text-inv-red`} onClick={() => void cancelLast()} disabled={busy}><UndoIcon /><span className="min-w-0 truncate">取消{lastTransactionItemName ? `：${lastTransactionItemName}` : ''}</span><span className="shrink-0">{formatSignedDelta(lastTransaction.delta)}{lastTransactionUnit}</span></button> : null}
        <span className="mx-1 h-7 w-px bg-inv-line" />
        <Link to="/kiosk/inventory/settings" className={`${invButton} h-12 rounded-xl`}><LockIcon />在庫の準備</Link>
      </div>

      {selectedCompartment ? (
        <div className="relative grid min-h-0 flex-1 grid-cols-[minmax(0,5fr)_minmax(0,6fr)] gap-4">
          <div className="min-h-0">
            <InventoryPhotoPane key={selectedCompartment.id} photos={selectedPhotos} />
          </div>
          <div className="flex min-h-0 min-w-0 flex-col gap-3.5 overflow-y-auto">
            <div className="shrink-0">
              <h2 title={selectedCompartment.item.name} className="line-clamp-3 break-all text-[30px] font-black leading-tight">{selectedCompartment.item.name}</h2>
              <p className="min-w-0 break-all text-[17px] text-inv-muted"><span className={`${invLabelNumber} mr-2`}>{formatInventoryLabelNumber(selectedCompartment.labelNumber)}</span>{selectedCompartment.area}・棚{selectedCompartment.shelfNumber}・引き出し{selectedCompartment.drawerNumber}</p>
            </div>
            <dl className={`${invCard} flex shrink-0 flex-wrap items-end gap-2.5 rounded-[18px] px-5 py-4`}>
              <dd aria-label="現在庫" className="flex min-w-0 max-w-full flex-wrap items-end gap-2.5">
                <span className="max-w-full shrink-0 break-all text-[88px] font-black leading-[0.95] tracking-[-0.02em] tabular-nums">{Number.isFinite(selectedCompartment.stockQuantity) ? selectedCompartment.stockQuantity : '—'}</span>
                <span className="min-w-0 break-all pb-2 text-[22px] font-bold text-inv-muted">{unitLabel(selectedCompartment.item)}</span>
                {messageKind === 'success' && resultTransaction?.compartmentId === selectedCompartment.id ? <span className={`pb-1.5 text-[38px] font-black tabular-nums ${resultTransaction.action === 'ISSUE' ? 'text-inv-amber' : resultTransaction.action === 'RESTOCK' ? 'text-inv-green' : 'text-inv-muted'}`}>{formatSignedDelta(resultTransaction.delta)}</span> : null}
              </dd>
              <dd className="ml-auto min-w-0 self-center">
                <button type="button" className={`${invButtonGhost} min-h-12 max-w-full !whitespace-normal rounded-xl`} disabled={busy || refreshingTag || !Number.isFinite(selectedCompartment?.stockQuantity)} onClick={() => { setCorrectionError(null); setPanel('correct'); }}><EditIcon />数が合わないときは直す</button>
              </dd>
            </dl>
            <p className={invEyebrow}>{restockMode ? '補充する数' : '払い出す数'}</p>
            <div className="flex flex-wrap gap-2.5" role="group" aria-label={restockMode ? '補充する数' : '払い出す数'}>
              {[1, 2, 5, 10, 20].map((quantity) => <button key={quantity} type="button" aria-label={`${quantity}${unitLabel(selectedCompartment.item)}を${restockMode ? '補充' : '払い出す'}`} className={`h-[76px] w-[92px] rounded-[14px] border-[1.5px] text-[30px] font-black tabular-nums disabled:opacity-40 ${restockMode ? 'border-inv-green bg-inv-green/10' : 'border-inv-amber bg-inv-amber/10'}`} disabled={busy || refreshingTag || !Number.isFinite(selectedCompartment?.stockQuantity)} onClick={() => void submitQuantity(quantity)}>{quantity}</button>)}
              <button type="button" className="h-[76px] rounded-[14px] border-[1.5px] border-inv-line2 bg-inv-s2 px-[18px] text-[17px] font-bold disabled:opacity-40" disabled={busy || refreshingTag || !Number.isFinite(selectedCompartment?.stockQuantity)} onClick={() => { setQuantityError(null); setPanel('quantity'); }}>ほかの数</button>
            </div>
            <div className="h-11 shrink-0" aria-live="polite">{quantityError && panel !== 'quantity' ? <p role="alert" className="text-inv-red">{quantityError}</p> : null}</div>
            <InventoryRecentHistory key={selectedCompartment.id} compartmentId={selectedCompartment.id} />
          </div>
          {panel === 'quantity' ? <div className="absolute inset-0 z-10 flex items-center justify-center rounded-[18px] bg-[#05080d]/80">
            <InventoryQuantityPanel unit={unitLabel(selectedCompartment.item)} restock={restockMode} pending={busy} error={quantityError} onConfirm={(quantity) => void submitQuantity(quantity)} onCancel={() => { setPanel('none'); setQuantityError(null); }} />
          </div> : null}
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
          <div className="flex shrink-0 items-center gap-3">
            <div className="flex max-h-28 min-w-0 flex-1 flex-wrap items-center gap-2 overflow-y-auto" role="group" aria-label="エリアで絞る">
              <span className={`${invEyebrow} w-[3.2em]`}>エリア</span>
              <button type="button" className={chipClass(effectiveArea === null)} aria-pressed={effectiveArea === null} onClick={() => { setAreaFilter(null); setShelfFilter(null); }}>{defaultArea === null ? <KioskHomeIcon filled className="h-4 w-4" /> : null}すべて <small className="font-normal opacity-75">{itemCompartments.length}</small></button>
              {areas.map(({ area, count }) => <button key={area} type="button" className={chipClass(effectiveArea === area)} aria-pressed={effectiveArea === area} onClick={() => { setAreaFilter(effectiveArea === area ? null : area); setShelfFilter(null); }}>{defaultArea === area ? <KioskHomeIcon filled className="h-4 w-4" /> : null}{area} <small className="font-normal opacity-75">{count}</small></button>)}
            </div>
            <button type="button" aria-label={homeLabel} title={homeLabel} aria-pressed={isDefaultArea} className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border hover:bg-inv-s2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-inv-cyan ${isDefaultArea ? 'border-inv-cyan text-inv-cyan' : 'border-inv-line2 text-inv-text'}`} onClick={() => isDefaultArea ? setAreaNotice({ message: 'このエリアが最初の表示です' }) : saveArea(effectiveArea)}><KioskHomeIcon filled={isDefaultArea} /></button>
            <button type="button" className={invButton} aria-expanded={numberOpen} onClick={() => { numberLookupRef.current += 1; setNumberOpen((open) => !open); setNumberInput(''); setNumberError(null); }}>番号で開く</button>
            <span className={`${invEyebrow} shrink-0`}>写真の大きさ</span>
            <div role="group" aria-label="写真の大きさ" className="inline-flex shrink-0 overflow-hidden rounded-xl border border-inv-line2">
              {([['small', '小'], ['medium', '中'], ['large', '大']] as const).map(([size, label]) => <button key={size} type="button" aria-pressed={thumbnailSize === size} className={`h-12 min-w-14 px-4 font-bold ${thumbnailSize === size ? 'bg-inv-cyan text-inv-cyan-ink' : 'text-inv-muted'}`} onClick={() => changeSize(size)}>{label}</button>)}
            </div>
          </div>
          {effectiveArea !== null ? <div className="flex max-h-28 shrink-0 flex-wrap items-center gap-2 overflow-y-auto" role="group" aria-label="棚で絞る">
            <span className={`${invEyebrow} w-[3.2em]`}>棚</span>
            <button type="button" className={chipClass(shelfFilter === null)} aria-pressed={shelfFilter === null} onClick={() => setShelfFilter(null)}>すべて</button>
            {shelves.map((shelf) => <button key={shelf} type="button" className={chipClass(shelfFilter === shelf)} aria-pressed={shelfFilter === shelf} onClick={() => setShelfFilter(shelfFilter === shelf ? null : shelf)}>棚{shelf}</button>)}
          </div> : null}
          <p className="flex shrink-0 items-baseline gap-2.5"><span className={invEyebrow}>登録済み</span><span className="font-black tabular-nums">{itemCompartments.length}</span><span className="text-[13px] text-inv-faint">件 ・ 最近持ち出した順</span>
            {pendingImports.length > 0 ? <><span className={`${invEyebrow} ml-3 text-inv-amber`}>未登録</span><span className="font-black tabular-nums text-inv-amber">{pendingImports.length}</span><span className="text-[13px] text-inv-faint">件</span></> : null}
          </p>
          {itemsQuery.isLoading ? <p className="text-inv-muted">読み込み中…</p> : itemsQuery.isError ? <div className="flex items-center gap-3"><p role="alert" className="text-inv-red">一覧を取得できませんでした</p><button type="button" className={invButtonGhost} onClick={() => void itemsQuery.refetch()}>もう一度</button></div> : <InventoryItemGrid
            size={thumbnailSize}
            compartments={filteredCompartments}
            onPick={pickCompartment}
            pending={pendingImports}
            onPickPending={pickPending}
          />}
        </>
      )}
      {areaNotice ? <div role="status" aria-label="最初のエリア" className="fixed bottom-36 right-5 z-50 flex items-center gap-4 rounded-xl border border-inv-line2 bg-inv-s3 px-5 py-3 text-lg font-semibold shadow-lg">
        <span>{areaNotice.message}</span>
        {areaNotice.undo ? <button type="button" className={`${invButtonGhost} text-inv-cyan`} onClick={() => saveArea(areaNotice.undo!.area, true)}>元に戻す</button> : null}
      </div> : null}
      {numberOpen ? <section aria-label="番号入力" className={`${invCard} absolute right-7 top-24 z-20 flex w-[280px] flex-col gap-3 p-4 shadow-xl`}>
        <div className="flex items-center justify-between gap-2"><h2 className="font-bold">番号で開く</h2><button type="button" className={invButtonGhost} onClick={() => { numberLookupRef.current += 1; setNumberOpen(false); }}>閉じる</button></div>
        <output aria-label="入力した番号" className={`text-center font-mono font-bold tabular-nums tracking-[0.14em] text-inv-amber ${numberInput.length > 6 ? 'text-[24px]' : 'text-[36px]'}`}>{numberInput.padEnd(4, '_')}</output>
        <div role="group" aria-label="番号のテンキー" className="grid grid-cols-3 gap-2">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', '消', '0', '←'].map((key) => <button key={key} type="button" className={`${invButton} h-14 px-0 text-xl`} disabled={numberBusy} onClick={() => {
            setNumberError(null);
            setNumberInput((value) => key === '消' ? '' : key === '←' ? value.slice(0, -1) : value.length < 10 && Number(value + key) <= 2147483647 ? value + key : value);
          }}>{key}</button>)}
        </div>
        {numberError ? <p role="alert" className="text-sm text-inv-red">{numberError}</p> : null}
        <button type="button" className={invButton} disabled={numberBusy || numberInput.length === 0} onClick={() => void openNumber()}>{numberBusy ? '確認中…' : '開く'}</button>
      </section> : null}
    </section>
  );
}
