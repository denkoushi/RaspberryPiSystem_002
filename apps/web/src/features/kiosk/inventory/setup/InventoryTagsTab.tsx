import { useEffect, useMemo, useRef, useState } from 'react';

import { useInventoryItems, useInventoryMutations, useInventoryTags } from '../../../../api/hooks';
import { KioskDigitTenkey } from '../../KioskDigitTenkey';
import { compartmentLocationText } from '../inventoryDailyFlow';
import { PlusIcon } from '../InventoryIcons';
import { InventoryLocationPicker } from '../InventoryLocationPicker';
import { invSetupTargets, invButton, invButtonGhost, invButtonPrimary, invCard, invKey, invKeyUtil, invPanel, invSeg } from '../inventoryUi';

import { NfcScanPanel } from './NfcScanPanel';
import { setupErrorText as errorText } from './setupError';
import { subscribeSetupLock, touchSetupPin } from './setupPinSession';
import { useArmedNfcRead } from './useArmedNfcRead';

import type { InventoryCompartment, InventoryTag } from '../../../../api/client';
import type { NfcEvent } from '../../../../hooks/useNfcStream';

type Mode =
  | { kind: 'idle' }
  | { kind: 'quantity-number'; value: string }
  | { kind: 'quantity-scan'; quantity: number }
  | { kind: 'restock-scan' }
  | { kind: 'swap-pick' }
  | { kind: 'swap-scan'; compartment: InventoryCompartment };

export function InventoryTagsTab({ accessPassword }: { accessPassword: string }) {
  const tagsQuery = useInventoryTags();
  const mutations = useInventoryMutations(accessPassword, true);
  const [mode, setMode] = useState<Mode>({ kind: 'idle' });
  const busyRef = useRef(false);
  const queueRef = useRef<Array<{ uid: string; quantity: number }>>([]);
  const batchRef = useRef(0);
  const seenRef = useRef(new Set<string>());
  const [registeredCount, setRegisteredCount] = useState(0);
  const [lastQuantity, setLastQuantity] = useState('');
  const [selectedQuantity, setSelectedQuantity] = useState<number | null>(null);
  const [deletedIds, setDeletedIds] = useState<string[]>([]);
  const [undoTag, setUndoTag] = useState<InventoryTag | null>(null);
  const [deleteError, setDeleteError] = useState<{ id: string; text: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const scanning = mode.kind === 'quantity-scan' || mode.kind === 'restock-scan' || mode.kind === 'swap-scan';
  const read = useArmedNfcRead(scanning && (mode.kind === 'quantity-scan' || !pending));
  const itemsQuery = useInventoryItems(mode.kind === 'swap-pick');
  const handledRef = useRef<NfcEvent | null>(null);

  const quantityCounts = useMemo(() => {
    const counts = new Map<number, number>();
    for (const tag of (tagsQuery.data ?? []).filter((entry) => !deletedIds.includes(entry.id))) {
      if (tag.kind === 'QUANTITY' && tag.quantity != null) counts.set(tag.quantity, (counts.get(tag.quantity) ?? 0) + 1);
    }
    return [...counts.entries()].sort(([a], [b]) => a - b);
  }, [tagsQuery.data, deletedIds]);
  const tags = (tagsQuery.data ?? []).filter((tag) => !deletedIds.includes(tag.id));
  const restockCount = tags.filter((tag) => tag.kind === 'RESTOCK').length;

  const discardQueue = () => {
    batchRef.current += 1;
    for (const entry of queueRef.current) seenRef.current.delete(entry.uid);
    queueRef.current = [];
  };
  useEffect(() => {
    const unsubscribe = subscribeSetupLock(discardQueue);
    return () => { unsubscribe(); discardQueue(); };
  }, []);

  const register = async (uid: string) => {
    if (mode.kind === 'quantity-scan') {
      if (seenRef.current.has(uid)) {
        setDone('このタグは登録済みです');
        return;
      }
      // Capture both values now, rather than using the mode after an earlier reply.
      seenRef.current.add(uid);
      queueRef.current.push({ uid, quantity: mode.quantity });
      if (busyRef.current) return;
      busyRef.current = true;
      setPending(true);
      setError(null);
      const batch = batchRef.current;
      try {
        while (queueRef.current.length && batch === batchRef.current) {
          const entry = queueRef.current.shift()!;
          try {
            await mutations.quantityTag.mutateAsync(entry);
          } catch (caught) {
            seenRef.current.delete(entry.uid);
            throw caught;
          }
          if (batch !== batchRef.current) return;
          setRegisteredCount((count) => count + 1);
          setLastQuantity(String(entry.quantity));
          setDone(`数量タグ「${entry.quantity}」を登録しました`);
        }
      } catch (caught) {
        if (batch === batchRef.current) {
          discardQueue();
          setError(errorText(caught));
        }
      } finally {
        busyRef.current = false;
        setPending(false);
      }
      return;
    }
    if (busyRef.current) return;
    busyRef.current = true;
    setPending(true);
    setError(null);
    try {
      if (mode.kind === 'restock-scan') {
        await mutations.restockTag.mutateAsync(uid);
        setDone('補充タグを登録しました');
      } else if (mode.kind === 'swap-scan') {
        await mutations.replaceTag.mutateAsync({ id: mode.compartment.id, uid });
        setDone(`${mode.compartment.item.name} のタグを付け替えました`);
      } else {
        return;
      }
      setMode({ kind: 'idle' });
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      busyRef.current = false;
      setPending(false);
    }
  };

  useEffect(() => {
    if (!read || handledRef.current === read) return;
    handledRef.current = read;
    touchSetupPin();
    void register(read.uid);
    // register reads the current mode; a new read is the only trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [read]);

  const start = (next: Mode) => { setUndoTag(null); setDeleteError(null); setError(null); setDone(null); setMode(next); };
  const cancel = () => { discardQueue(); setError(null); setMode({ kind: 'idle' }); };

  const removeTag = async (tag: InventoryTag) => {
    if (busyRef.current || tag.kind === 'ITEM' || (tag.kind === 'QUANTITY' && tag.quantity == null)) return;
    busyRef.current = true;
    setPending(true);
    setDeleteError(null);
    setUndoTag(null);
    try {
      await mutations.deleteTag.mutateAsync(tag.id);
      setDeletedIds((ids) => [...ids, tag.id]);
      setUndoTag(tag);
    } catch (caught) {
      setDeleteError({ id: tag.id, text: errorText(caught) });
    } finally {
      busyRef.current = false;
      setPending(false);
    }
  };
  const restoreTag = async () => {
    if (!undoTag || busyRef.current) return;
    busyRef.current = true;
    setPending(true);
    setDeleteError(null);
    try {
      if (undoTag.kind === 'QUANTITY' && undoTag.quantity != null) await mutations.quantityTag.mutateAsync({ uid: undoTag.uid, quantity: undoTag.quantity });
      else if (undoTag.kind === 'RESTOCK') await mutations.restockTag.mutateAsync(undoTag.uid);
      setUndoTag(null);
    } catch (caught) {
      setDeleteError({ id: 'undo', text: errorText(caught) });
    } finally {
      busyRef.current = false;
      setPending(false);
    }
  };
  const tagRows = (entries: InventoryTag[]) => <ul className="max-h-52 overflow-y-auto">
    {entries.map((tag) => <li key={tag.id} className="flex min-h-11 flex-wrap items-center gap-2 border-t border-inv-line py-1">
      <span className="min-w-0 flex-1 break-all font-mono text-sm">{tag.uid}</span>
      <button type="button" className={invButtonGhost} aria-label={`タグ ${tag.uid} を削除`} disabled={pending || scanning || (tag.kind === 'QUANTITY' && tag.quantity == null)} onClick={() => void removeTag(tag)}>削除</button>
      <div className="h-8 w-full overflow-hidden text-sm leading-4">{deleteError?.id === tag.id ? <p role="alert" className="line-clamp-2 text-[#ffd0d0]">{deleteError.text}</p> : null}</div>
    </li>)}
  </ul>;

  if (mode.kind === 'swap-pick') {
    return (
      <div className={`${invSetupTargets} [&_.truncate]:whitespace-normal [&_.truncate]:break-all [&_.truncate]:line-clamp-2 [&_button]:max-w-full [&_button]:whitespace-normal flex min-h-0 flex-1 flex-col pt-4`}>
        <InventoryLocationPicker
          items={itemsQuery.data ?? []}
          loading={itemsQuery.isLoading}
          onPick={(compartment) => start({ kind: 'swap-scan', compartment })}
          onClose={cancel}
        />
      </div>
    );
  }

  const scanLabel = mode.kind === 'quantity-scan'
    ? `新しい数量タグ「${mode.quantity}」`
    : mode.kind === 'restock-scan'
      ? '新しい補充タグ'
      : 'アイテムタグ';
  const scanSub = mode.kind === 'swap-scan' ? `${mode.compartment.item.name}（${compartmentLocationText(mode.compartment).replace('引出し', '引き出し')}）` : undefined;
  const sectionClass = `${invPanel} flex flex-col gap-3 p-5`;
  const heading = (title: string, sub: string) => (
    <div className="min-w-0 flex-1">
      <h2 className="text-lg font-black">{title}</h2>
      <p className="text-[13px] text-inv-faint">{sub}</p>
    </div>
  );

  return (
    <div className={`${invSetupTargets} grid grid-cols-[860px_520px] items-start gap-5 pt-4`}>
      <div className="flex flex-col gap-4">

        <section className={`${invPanel} flex flex-col gap-3.5 p-5`} aria-label="数量タグ">
          <div className="flex items-center gap-3">
            {heading('数量タグ', '数だけを表すタグ（単位はアイテムごと）')}
            <button type="button" className={invButton} disabled={scanning || pending} onClick={() => { seenRef.current.clear(); setRegisteredCount(0); start({ kind: 'quantity-number', value: lastQuantity }); }}><PlusIcon />タグを追加</button>
          </div>
          {quantityCounts.length === 0 ? <p className="text-inv-faint">まだありません</p> : (
            <ul className="flex flex-wrap gap-2.5">
              {quantityCounts.map(([quantity, count]) => (
                <li key={quantity} className={`${invCard} flex h-[92px] w-28 flex-col items-center justify-center`}>
                  <button type="button" className="flex h-full w-full flex-col items-center justify-center rounded-[14px]" aria-label={`数量${quantity}のタグ`} aria-pressed={quantity === selectedQuantity} onClick={() => setSelectedQuantity(quantity === selectedQuantity ? null : quantity)}>
                  <span className="text-[34px] font-black leading-none tabular-nums">{quantity}</span>
                  <span className="mt-1 text-[11px] text-inv-faint">{count}枚</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {selectedQuantity != null ? tagRows(tags.filter((tag) => tag.kind === 'QUANTITY' && tag.quantity === selectedQuantity)) : null}
        </section>
        <section className={sectionClass} aria-label="補充タグ">
          <div className="flex items-center gap-3">{heading('補充タグ', `かざすと補充モードになるタグ ・ ${restockCount}枚 登録済み`)}
          <button type="button" className={invButton} disabled={scanning || pending} onClick={() => start({ kind: 'restock-scan' })}><PlusIcon />タグを追加</button></div>
          {tagRows(tags.filter((tag) => tag.kind === 'RESTOCK'))}
        </section>
        <section className={sectionClass} aria-label="アイテムのタグ交換">
          <div className="flex items-center gap-3">{heading('アイテムのタグ交換', 'なくした・壊れたタグの付け替え')}
          <button type="button" className={invButton} disabled={scanning || pending} onClick={() => start({ kind: 'swap-pick' })}>アイテムを選ぶ</button></div>
        </section>
      </div>
      <div className="flex flex-col gap-3">
        <div className="flex h-12 items-center gap-2 overflow-hidden" aria-live="polite">
          {undoTag ? <><span className="text-sm text-[#d7fbe9]">タグを削除しました</span><button type="button" className={invButtonGhost} disabled={pending} onClick={() => void restoreTag()}>元に戻す</button></> : null}
          {deleteError?.id === 'undo' ? <p role="alert" className="line-clamp-2 text-sm text-[#ffd0d0]">{deleteError.text}</p> : null}
          {!undoTag && registeredCount > 0 ? <span className="shrink-0 text-sm font-bold">登録 {registeredCount}件</span> : null}
          {!undoTag && done ? <p role="status" className="min-w-0 line-clamp-2 text-sm text-[#d7fbe9]">{done}</p> : null}
        </div>
        {mode.kind === 'quantity-number' ? (
          <section className={`${invPanel} flex flex-col gap-3 p-6`} aria-label="数量を選ぶ">
            <h2 className="text-lg font-black">このタグで持ち出す数</h2>
            <output className="rounded-xl bg-inv-s2 px-4 py-2 text-right text-[44px] font-black tabular-nums" aria-label="数量">{mode.value || '—'}</output>
            <KioskDigitTenkey value={mode.value} onChange={(next) => setMode({ kind: 'quantity-number', value: next.replace(/^0+(?=\d)/, '') })} maxLength={4} ariaLabel="数量のテンキー" className="grid grid-cols-3 gap-2.5 [&>button:nth-child(10)]:col-start-2" keyClassName={invKey} resetClassName={invKeyUtil} />
            <button type="button" className={`${invButtonPrimary} h-14 text-lg`} disabled={!mode.value || Number(mode.value) < 1} onClick={() => start({ kind: 'quantity-scan', quantity: Number(mode.value) })}>次へ：タグをかざす</button>
            <button type="button" className={invButtonGhost} onClick={cancel}>やめる</button>
          </section>
        ) : scanning ? (
          <>
          {mode.kind === 'quantity-scan' ? <div className="flex flex-wrap gap-2" role="group" aria-label="次の数量">
            {[...new Set([1, 2, 3, 5, 10, 20, mode.quantity])].sort((a, b) => a - b).map((quantity) => <button key={quantity} type="button" className={invSeg(quantity === mode.quantity)} aria-pressed={quantity === mode.quantity} onClick={() => { setLastQuantity(String(quantity)); setMode({ kind: 'quantity-scan', quantity }); }}>{quantity}</button>)}
            <button type="button" className={invButtonGhost} disabled={pending} onClick={() => setMode({ kind: 'quantity-number', value: String(mode.quantity) })}>ほかの数</button>
          </div> : null}
          <NfcScanPanel large cancelWhilePending={mode.kind === 'quantity-scan'} cancelLabel={mode.kind === 'quantity-scan' ? '終わる' : undefined} label={scanLabel} sub={scanSub} pending={pending} error={error} onManualUid={(uid) => void register(uid)} onCancel={cancel} />
          </>
        ) : null}
      </div>
    </div>
  );
}
