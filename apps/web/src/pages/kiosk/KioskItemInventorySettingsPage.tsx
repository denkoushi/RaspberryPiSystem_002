import { useState } from 'react';
import { Link } from 'react-router-dom';

import { invButtonSmGhost, invSurface } from '../../features/kiosk/inventory/inventoryUi';
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
    <section className={invSurface}>
      {/* Title, tabs and the way back share one row so the tab content gets the height. */}
      <div className="flex shrink-0 flex-wrap items-center gap-4 border-b border-inv-line">
        <h1 className="text-[22px] font-black tracking-[0.02em]">在庫の準備</h1>
        <span className="rounded-md bg-inv-amber/[0.12] px-2 py-0.5 text-[11px] font-bold tracking-[0.08em] text-inv-amber">解除中</span>
        <div role="tablist" aria-label="在庫の準備" className="ml-3 flex gap-0.5">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={entry.id === tab}
              className={entry.id === tab
                ? 'h-12 border-b-[3px] border-inv-cyan px-[18px] text-base font-black text-inv-text'
                : 'h-12 border-b-[3px] border-transparent px-[18px] text-base text-inv-muted hover:text-inv-text'}
              onClick={() => setTab(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <Link to="/kiosk/inventory" className={`${invButtonSmGhost} ml-auto`}>在庫操作に戻る</Link>
      </div>
      <div role="tabpanel" aria-label={TABS.find((entry) => entry.id === tab)?.label} className="flex min-h-0 flex-1 flex-col">
        {tab === 'review' ? <InventoryRegistrationTab accessPassword={accessPassword} /> : null}
        {tab === 'shelves' ? <InventoryShelvesTab accessPassword={accessPassword} /> : null}
        {tab === 'tags' ? <InventoryTagsTab accessPassword={accessPassword} /> : null}
        {tab === 'items' ? <InventoryItemEditTab accessPassword={accessPassword} /> : null}
      </div>
    </section>
  );
}
