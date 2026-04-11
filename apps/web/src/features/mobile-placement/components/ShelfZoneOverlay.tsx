import clsx from 'clsx';
import { useEffect, useId } from 'react';
import { createPortal } from 'react-dom';

import { Button } from '../../../components/ui/Button';

import type { ShelfZoneDefinition } from '../shelfZones/shelfZoneTypes';

export type ShelfZoneOverlayProps = {
  open: boolean;
  zone: ShelfZoneDefinition | null;
  selectedShelfCode: string;
  onClose: () => void;
  onSelectShelf: (code: string) => void;
};

/**
 * ゾーン別棚一覧（全画面・ダーク）。表示内容は ShelfZoneDefinition に委ね、ここは配置と操作のみ。
 */
export function ShelfZoneOverlay({
  open,
  zone,
  selectedShelfCode,
  onClose,
  onSelectShelf
}: ShelfZoneOverlayProps) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !zone) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-slate-950/95 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))]"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div className="mb-3 flex shrink-0 items-center justify-between gap-3">
        <h2 id={titleId} className="m-0 text-base font-bold text-amber-200">
          {zone.overlayTitle}
        </h2>
        <button
          type="button"
          className="shrink-0 rounded-[10px] border border-white/30 bg-white/10 px-4 py-2.5 text-sm font-semibold text-white active:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/40"
          onClick={onClose}
        >
          閉じる
        </button>
      </div>

      <div className="grid min-h-0 min-w-0 flex-1 grid-cols-2 gap-2 overflow-y-auto pb-2">
        {zone.shelfCodes.map((code) => (
          <Button
            key={code}
            type="button"
            variant={selectedShelfCode === code ? 'primary' : 'ghostOnDark'}
            className={clsx(
              'min-h-14 min-w-0 max-w-full justify-center px-2 py-2.5 text-[26px] font-semibold tabular-nums !text-white',
              selectedShelfCode !== code && 'border border-amber-400/25 bg-slate-800'
            )}
            aria-label={`棚 ${code}`}
            onClick={() => {
              onSelectShelf(code);
              onClose();
            }}
          >
            {code}
          </Button>
        ))}
      </div>
    </div>,
    document.body
  );
}
