import { useEffect, useMemo, useRef, useState } from 'react';

import { useInventoryItems, useInventoryMutations, useInventoryTags } from '../../../../api/hooks';
import { KioskDigitTenkey } from '../../KioskDigitTenkey';
import { kioskButtonPrimaryClassName, kioskButtonSecondaryClassName, kioskPanelClassName } from '../../kioskTheme';
import { compartmentLocationText } from '../inventoryDailyFlow';
import { InventoryLocationPicker } from '../InventoryLocationPicker';

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

const keyClassName =
  'inline-flex h-14 items-center justify-center rounded-lg border border-white/15 bg-slate-950 text-2xl font-bold text-white hover:bg-slate-800 disabled:opacity-40';

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
        setDone(`数量タグ「${mode.quantity}個」を登録しました`);
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
      <InventoryLocationPicker
        items={itemsQuery.data ?? []}
        loading={itemsQuery.isLoading}
        onPick={(compartment) => start({ kind: 'swap-scan', compartment })}
        onClose={cancel}
      />
    );
  }

  const scanTitle = mode.kind === 'quantity-scan'
    ? `数量タグ「${mode.quantity}個」を登録中`
    : mode.kind === 'restock-scan'
      ? '補充タグを登録中'
      : mode.kind === 'swap-scan'
        ? `${mode.compartment.item.name}（${compartmentLocationText(mode.compartment)}）の新しいタグ`
        : '';

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_28rem]">
      <div className="flex flex-col gap-4">
        {done ? <p className="rounded-lg border border-emerald-400/60 bg-emerald-900/40 p-3 text-lg font-semibold text-emerald-100" role="status">{done}</p> : null}
        <section className={`${kioskPanelClassName} flex flex-col gap-3 p-4`} aria-label="数量タグ">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold text-white">数量タグ</h2>
              <p className="text-sm text-white/60">持ち出す数を決めるタグ</p>
            </div>
            <button type="button" className={`${kioskButtonSecondaryClassName} min-h-12 text-lg`} disabled={scanning} onClick={() => start({ kind: 'quantity-number', value: '' })}>＋ タグを追加</button>
          </div>
          {quantityCounts.length === 0 ? <p className="text-white/60">まだありません</p> : (
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {quantityCounts.map(([quantity, count]) => (
                <li key={quantity} className="rounded-lg bg-slate-950/50 p-3 text-center text-white">
                  <span className="text-3xl font-bold">{quantity}</span><span className="text-base">個</span>
                  <span className="block text-sm text-white/60">{count}枚</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className={`${kioskPanelClassName} flex items-center justify-between gap-3 p-4`} aria-label="補充タグ">
          <div>
            <h2 className="text-xl font-bold text-white">補充タグ</h2>
            <p className="text-sm text-white/60">かざすと補充モードになるタグ ・ {restockCount}枚 登録済み</p>
          </div>
          <button type="button" className={`${kioskButtonSecondaryClassName} min-h-12 text-lg`} disabled={scanning} onClick={() => start({ kind: 'restock-scan' })}>＋ タグを追加</button>
        </section>
        <section className={`${kioskPanelClassName} flex items-center justify-between gap-3 p-4`} aria-label="アイテムのタグ交換">
          <div>
            <h2 className="text-xl font-bold text-white">アイテムのタグ交換</h2>
            <p className="text-sm text-white/60">なくした・壊れたタグの付け替え</p>
          </div>
          <button type="button" className={`${kioskButtonSecondaryClassName} min-h-12 text-lg`} disabled={scanning} onClick={() => start({ kind: 'swap-pick' })}>アイテムを選ぶ</button>
        </section>
      </div>
      <div>
        {mode.kind === 'quantity-number' ? (
          <section className={`${kioskPanelClassName} flex flex-col gap-3 p-4`} aria-label="数量を選ぶ">
            <h2 className="text-xl font-bold text-white">このタグで持ち出す数</h2>
            <output className="rounded bg-slate-950 px-3 py-2 text-right text-4xl font-bold text-white" aria-label="数量">{mode.value || '—'}</output>
            <KioskDigitTenkey value={mode.value} onChange={(next) => setMode({ kind: 'quantity-number', value: next.replace(/^0+(?=\d)/, '') })} maxLength={4} ariaLabel="数量のテンキー" className="grid grid-cols-3 gap-2" keyClassName={keyClassName} />
            <button type="button" className={`${kioskButtonPrimaryClassName} min-h-14 text-lg`} disabled={!mode.value || Number(mode.value) < 1} onClick={() => start({ kind: 'quantity-scan', quantity: Number(mode.value) })}>次へ：タグをかざす</button>
            <button type="button" className={`${kioskButtonSecondaryClassName} min-h-12`} onClick={cancel}>やめる</button>
          </section>
        ) : scanning ? (
          <NfcScanPanel title={scanTitle} pending={pending} error={error} onManualUid={(uid) => void register(uid)} onCancel={cancel} />
        ) : null}
      </div>
    </div>
  );
}
