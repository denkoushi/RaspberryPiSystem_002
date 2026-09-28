import { useState } from 'react';
import { Link } from 'react-router-dom';

import { InventoryItemEditTab } from '../../features/kiosk/inventory/setup/InventoryItemEditTab';
import { InventoryPinPad } from '../../features/kiosk/inventory/setup/InventoryPinPad';
import { InventoryRegistrationTab } from '../../features/kiosk/inventory/setup/InventoryRegistrationTab';
import { InventoryShelvesTab } from '../../features/kiosk/inventory/setup/InventoryShelvesTab';
import { InventoryTagsTab } from '../../features/kiosk/inventory/setup/InventoryTagsTab';

type SetupTab = 'review' | 'shelves' | 'tags' | 'items';

const TABS: Array<{ id: SetupTab; label: string }> = [
  { id: 'review', label: '登録待ち' },
  { id: 'shelves', label: '棚・引き出し' },
  { id: 'tags', label: 'NFCタグ' },
  { id: 'items', label: 'アイテム編集' },
];

export function KioskItemInventorySettingsPage() {
  // The verified PIN lives only while this page is mounted; leaving it locks setup again.
  const [accessPassword, setAccessPassword] = useState<string | null>(null);
  const [tab, setTab] = useState<SetupTab>('review');

  if (!accessPassword) return <InventoryPinPad onUnlocked={setAccessPassword} />;

  return (
    <section className="flex w-full flex-col gap-3">
      {/* Title, tabs and the way back share one row so the tab content gets the height. */}
      <div className="flex flex-wrap items-center gap-3 border-b border-white/15">
        <h1 className="text-xl font-bold text-white">在庫の準備</h1>
        <span className="rounded-full bg-amber-900/70 px-2.5 py-0.5 text-xs font-bold text-amber-100">解除中</span>
        <div role="tablist" aria-label="在庫の準備" className="ml-4 flex gap-1">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={entry.id === tab}
              className={entry.id === tab
                ? 'h-11 border-b-[3px] border-sky-400 px-4 text-base font-bold text-white'
                : 'h-11 border-b-[3px] border-transparent px-4 text-base text-white/60 hover:text-white'}
              onClick={() => setTab(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <Link to="/kiosk/inventory" className="ml-auto inline-flex h-9 items-center rounded-md border border-white/20 px-3 text-sm text-white hover:bg-white/10">在庫操作に戻る</Link>
      </div>
      <div role="tabpanel" aria-label={TABS.find((entry) => entry.id === tab)?.label}>
        {tab === 'review' ? <InventoryRegistrationTab accessPassword={accessPassword} /> : null}
        {tab === 'shelves' ? <InventoryShelvesTab accessPassword={accessPassword} /> : null}
        {tab === 'tags' ? <InventoryTagsTab accessPassword={accessPassword} /> : null}
        {tab === 'items' ? <InventoryItemEditTab accessPassword={accessPassword} /> : null}
      </div>
    </section>
  );
}
