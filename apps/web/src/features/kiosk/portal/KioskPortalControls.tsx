import { KIOSK_REORDERABLE_HEADER_TAB_IDS, normalizeKioskHeaderTabOrder } from '@raspi-system/shared-types';
import { useState } from 'react';

import { useKioskConfig, useUpdateKioskPortalCards } from '../../../api/hooks';
import { Dialog } from '../../../components/ui/Dialog';
import { KIOSK_HEADER_TAB_LABELS } from '../kioskHeaderTabs/kioskHeaderTabLabels';

import { groupKioskPortalTabs } from './kioskPortalGroups';

import type { KioskReorderableHeaderTabId } from '@raspi-system/shared-types';

const buttonClass = 'inline-flex h-11 items-center justify-center rounded-lg border border-inv-line2 px-4 text-base font-semibold text-inv-text hover:bg-inv-s3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-inv-cyan disabled:opacity-50';

export function KioskPortalControls({ clientKey, largeScreen, onToggleLargeScreen }: {
  clientKey: string;
  largeScreen: boolean;
  onToggleLargeScreen: () => void;
}) {
  const { data: config } = useKioskConfig();
  const mutation = useUpdateKioskPortalCards(clientKey);
  const [hiddenIds, setHiddenIds] = useState<KioskReorderableHeaderTabId[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const groups = groupKioskPortalTabs(normalizeKioskHeaderTabOrder(config?.navTabOrder ?? []));
  const close = () => { if (!mutation.isPending) setHiddenIds(null); };
  const save = async () => {
    if (!hiddenIds || mutation.isPending) return;
    setError(null);
    try {
      await mutation.mutateAsync(hiddenIds);
      setHiddenIds(null);
    } catch {
      setError('保存できませんでした。接続を確認してもう一度お試しください。');
    }
  };
  return <>
    <button type="button" className={buttonClass} aria-pressed={largeScreen} onClick={onToggleLargeScreen}>50インチ表示</button>
    <button type="button" className={`${buttonClass} !px-3`} aria-label="出すカードを選ぶ" disabled={!config} onClick={() => {
      setHiddenIds(KIOSK_REORDERABLE_HEADER_TAB_IDS.filter((id) => config?.portalHiddenTabIds?.includes(id)));
      setError(null);
    }}>
      <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round" aria-hidden="true">
        <path d="m9 3-.6 3-2.6 1.5-2.9-1L1 10l2.3 2-2.3 2 1.9 3.5 2.9-1L8.4 18l.6 3h6l.6-3 2.6-1.5 2.9 1L23 14l-2.3-2 2.3-2-1.9-3.5-2.9 1L15.6 6 15 3z" /><circle cx="12" cy="12" r="3" />
      </svg>
    </button>
    <Dialog isOpen={hiddenIds !== null} onClose={close} title="この端末に出すカード" size="lg" className="!border-inv-line2 !bg-inv-bg !text-inv-text" titleClassName="!text-2xl" closeOnEsc={!mutation.isPending} closeOnBackdrop={!mutation.isPending}>
      <div className="my-4 flex gap-2">
        <button type="button" className={buttonClass} disabled={mutation.isPending} onClick={() => setHiddenIds([])}>全部</button>
        <button type="button" className={buttonClass} disabled={mutation.isPending} onClick={() => setHiddenIds([...KIOSK_REORDERABLE_HEADER_TAB_IDS])}>なし</button>
      </div>
      <div className="space-y-4">
        {groups.map((group) => <fieldset key={group.label} disabled={mutation.isPending}>
          <legend className={`mb-2 text-sm font-bold ${group.tint}`}>{group.label}</legend>
          <div className="flex flex-wrap gap-2">
            {group.tabIds.map((id) => <label key={id} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 font-semibold ${hiddenIds?.includes(id) ? 'border-inv-line text-inv-muted' : 'border-inv-line2 bg-inv-s2 text-inv-text'} ${group.hoverBorder}`}>
              <input type="checkbox" className="h-5 w-5 accent-inv-cyan" checked={!hiddenIds?.includes(id)} onChange={(event) => setHiddenIds((current) => event.target.checked ? (current ?? []).filter((value) => value !== id) : [...(current ?? []), id])} />
              {KIOSK_HEADER_TAB_LABELS[id]}
            </label>)}
          </div>
        </fieldset>)}
      </div>
      {error && <p role="alert" className="mt-4 text-inv-red">{error}</p>}
      <div className="mt-6 flex justify-end gap-3">
        <button type="button" className={buttonClass} disabled={mutation.isPending} onClick={close}>やめる</button>
        <button type="button" className={`${buttonClass} border-inv-cyan bg-inv-cyan !text-inv-cyan-ink hover:!bg-inv-cyan/90`} disabled={mutation.isPending} onClick={() => void save()}>{mutation.isPending ? '保存中…' : '保存'}</button>
      </div>
    </Dialog>
  </>;
}
