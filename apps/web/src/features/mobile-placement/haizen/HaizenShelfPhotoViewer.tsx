import { Dialog } from '../../../components/ui/Dialog';
import { ShelfPhoto } from '../shelfPhoto/ShelfPhoto';
import { haizenPhoneStyle, hp } from '../ui/haizenPhoneTokens';

import type { RegisteredShelfEntryDto } from '../registeredShelves';

export function HaizenShelfPhotoViewer({ shelf, onClose }: { shelf: RegisteredShelfEntryDto; onClose: () => void }) {
  return <Dialog isOpen onClose={onClose} ariaLabel="棚の写真を拡大" overlayZIndex={70}
    className="!fixed !inset-0 !m-auto !flex !h-dvh !max-h-none !w-full !max-w-[480px] !flex-col !rounded-none !border-0 !bg-[#0d0f0e] !p-0 !text-[#f2f4f1]">
    <div style={haizenPhoneStyle} className="flex min-h-0 flex-1 flex-col">
      <header className="shrink-0 px-3.5 py-3">
        <h2 className="break-all font-mono text-2xl font-bold text-[var(--hp-shelf)]">{shelf.shelfCodeRaw}</h2>
        {shelf.displayLabel && <p className={`break-words text-[15px] ${hp.muted}`}>{shelf.displayLabel}</p>}
      </header>
      <button type="button" aria-label="写真を閉じる" onClick={onClose} className="min-h-0 w-full flex-1">
        <ShelfPhoto shelf={shelf} fit="contain" className="h-full w-full" />
      </button>
      <footer className={hp.dock}><button type="button" className={`${hp.primary} bg-[var(--hp-ink)]`} onClick={onClose}>閉じる</button></footer>
    </div>
  </Dialog>;
}
