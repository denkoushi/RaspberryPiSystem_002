import { useEffect, useMemo, useRef, useState } from 'react';

import { useInventoryItems, useInventoryMutations, useInventoryTags } from '../../../../api/hooks';
import { KioskDigitTenkey } from '../../KioskDigitTenkey';
import { compartmentLocationText } from '../inventoryDailyFlow';
import { PlusIcon } from '../InventoryIcons';
import { InventoryLocationPicker } from '../InventoryLocationPicker';
import { invButton, invButtonGhost, invButtonPrimary, invCard, invKey, invKeyUtil, invPanel, invSuccess } from '../inventoryUi';

import { NfcScanPanel } from './NfcScanPanel';
import { useArmedNfcRead } from './useArmedNfcRead';

import type { InventoryCompartment } from '../../../../api/client';
import type { NfcEvent } from '../../../../hooks/useNfcStream';

type Mode =
  | { kind: 'idle' }
  | { kind: 'quantity-number'; value: string }
  | { kind: 'quantity-scan'; quantity: number }
  | { kind: 'restock-scan' }
  | { kind: 'swap-pick' }
  | { kind: 'swap-scan'; compartment: InventoryCompartment };

function errorText(error: unknown): string {
  const message = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
  if (message) return message;
  return error instanceof Error ? error.message : '登録に失敗しました';
}


export function InventoryTagsTab({ accessPassword }: { accessPassword: string }) {
  const tagsQuery = useInventoryTags();
  const mutations = useInventoryMutations(accessPassword);
  const [mode, setMode] = useState<Mode>({ kind: 'idle' });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const scanning = mode.kind === 'quantity-scan' || mode.kind === 'restock-scan' || mode.kind === 'swap-scan';
  const read = useArmedNfcRead(scanning && !pending);
  const itemsQuery = useInventoryItems(mode.kind === 'swap-pick');
  const handledRef = useRef<NfcEvent | null>(null);

  const quantityCounts = useMemo(() => {
    const counts = new Map<number, number>();
    for (const tag of tagsQuery.data ?? []) {
      if (tag.kind === 'QUANTITY' && tag.quantity != null) counts.set(tag.quantity, (counts.get(tag.quantity) ?? 0) + 1);
    }
    return [...counts.entries()].sort(([a], [b]) => a - b);
  }, [tagsQuery.data]);
  const restockCount = (tagsQuery.data ?? []).filter((tag) => tag.kind === 'RESTOCK').length;

  const register = async (uid: string) => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      if (mode.kind === 'quantity-scan') {
        await mutations.quantityTag.mutateAsync({ uid, quantity: mode.quantity });
        setDone(`数量タグ「${mode.quantity}」を登録しました`);
      } else if (mode.kind === 'restock-scan') {
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
      setPending(false);
    }
  };

  useEffect(() => {
    if (!read || handledRef.current === read) return;
    handledRef.current = read;
    void register(read.uid);
    // register reads the current mode; a new read is the only trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [read]);

  const start = (next: Mode) => { setError(null); setDone(null); setMode(next); };
  const cancel = () => { setError(null); setMode({ kind: 'idle' }); };

  if (mode.kind === 'swap-pick') {
    return (
      <div className="flex min-h-0 flex-1 flex-col pt-4">
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
  const scanSub = mode.kind === 'swap-scan' ? `${mode.compartment.item.name}（${compartmentLocationText(mode.compartment)}）` : undefined;
  const sectionClass = `${invPanel} flex items-center gap-3 p-5`;
  const heading = (title: string, sub: string) => (
    <div className="min-w-0 flex-1">
      <h2 className="text-lg font-black">{title}</h2>
      <p className="text-[13px] text-inv-faint">{sub}</p>
    </div>
  );

  return (
    <div className="grid grid-cols-[860px_520px] items-start gap-5 pt-4">
      <div className="flex flex-col gap-4">
        {done ? <p className={`rounded-xl border px-3 py-2 text-base font-bold ${invSuccess}`} role="status">{done}</p> : null}
        <section className={`${invPanel} flex flex-col gap-3.5 p-5`} aria-label="数量タグ">
          <div className="flex items-center gap-3">
            {heading('数量タグ', '数だけを表すタグ（単位はアイテムごと）')}
            <button type="button" className={invButton} disabled={scanning} onClick={() => start({ kind: 'quantity-number', value: '' })}><PlusIcon />タグを追加</button>
          </div>
          {quantityCounts.length === 0 ? <p className="text-inv-faint">まだありません</p> : (
            <ul className="flex flex-wrap gap-2.5">
              {quantityCounts.map(([quantity, count]) => (
                <li key={quantity} className={`${invCard} flex h-[92px] w-28 flex-col items-center justify-center`}>
                  <span className="text-[34px] font-black leading-none tabular-nums">{quantity}</span>
                  <span className="mt-1 text-[11px] text-inv-faint">{count}枚</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className={sectionClass} aria-label="補充タグ">
          {heading('補充タグ', `かざすと補充モードになるタグ ・ ${restockCount}枚 登録済み`)}
          <button type="button" className={invButton} disabled={scanning} onClick={() => start({ kind: 'restock-scan' })}><PlusIcon />タグを追加</button>
        </section>
        <section className={sectionClass} aria-label="アイテムのタグ交換">
          {heading('アイテムのタグ交換', 'なくした・壊れたタグの付け替え')}
          <button type="button" className={invButton} disabled={scanning} onClick={() => start({ kind: 'swap-pick' })}>アイテムを選ぶ</button>
        </section>
      </div>
      <div>
        {mode.kind === 'quantity-number' ? (
          <section className={`${invPanel} flex flex-col gap-3 p-6`} aria-label="数量を選ぶ">
            <h2 className="text-lg font-black">このタグで持ち出す数</h2>
            <output className="rounded-xl bg-inv-s2 px-4 py-2 text-right text-[44px] font-black tabular-nums" aria-label="数量">{mode.value || '—'}</output>
            <KioskDigitTenkey value={mode.value} onChange={(next) => setMode({ kind: 'quantity-number', value: next.replace(/^0+(?=\d)/, '') })} maxLength={4} ariaLabel="数量のテンキー" className="grid grid-cols-3 gap-2.5 [&>button:nth-child(10)]:col-start-2" keyClassName={invKey} resetClassName={invKeyUtil} />
            <button type="button" className={`${invButtonPrimary} h-14 text-lg`} disabled={!mode.value || Number(mode.value) < 1} onClick={() => start({ kind: 'quantity-scan', quantity: Number(mode.value) })}>次へ：タグをかざす</button>
            <button type="button" className={invButtonGhost} onClick={cancel}>やめる</button>
          </section>
        ) : scanning ? (
          <NfcScanPanel large label={scanLabel} sub={scanSub} pending={pending} error={error} onManualUid={(uid) => void register(uid)} onCancel={cancel} />
        ) : null}
      </div>
    </div>
  );
}
