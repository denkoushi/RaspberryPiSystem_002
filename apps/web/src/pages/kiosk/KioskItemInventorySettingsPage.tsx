import { useState } from 'react';
import { Link } from 'react-router-dom';

import { InventoryPinPad } from '../../features/kiosk/inventory/setup/InventoryPinPad';
import { InventoryShelvesTab } from '../../features/kiosk/inventory/setup/InventoryShelvesTab';
import { InventoryTagsTab } from '../../features/kiosk/inventory/setup/InventoryTagsTab';
import { kioskButtonSecondaryClassName } from '../../features/kiosk/kioskTheme';
import { RaspiInventoryPage } from '../admin/RaspiInventoryPage';

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
    <section className="flex w-full flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold text-white">在庫の準備</h1>
        <span className="rounded-full bg-amber-900/70 px-3 py-1 text-sm font-bold text-amber-100">解除中</span>
        <Link to="/kiosk/inventory" className={`${kioskButtonSecondaryClassName} ml-auto inline-flex items-center`}>在庫操作に戻る</Link>
      </div>
      <div role="tablist" aria-label="在庫の準備" className="flex flex-wrap gap-1 border-b border-white/15">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={entry.id === tab}
            className={entry.id === tab
              ? 'min-h-12 border-b-4 border-sky-400 px-5 text-lg font-bold text-white'
              : 'min-h-12 border-b-4 border-transparent px-5 text-lg text-white/60 hover:text-white'}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-label={TABS.find((entry) => entry.id === tab)?.label}>
        {tab === 'shelves' ? <InventoryShelvesTab accessPassword={accessPassword} /> : null}
        {tab === 'tags' ? <InventoryTagsTab accessPassword={accessPassword} /> : null}
        {/* Registration and item editing move to kiosk components in Milestones 4 and 5. */}
        {tab === 'review' || tab === 'items' ? <RaspiInventoryPage accessPassword={accessPassword} /> : null}
      </div>
    </section>
  );
}
