import { useEffect, useRef } from 'react';

import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';

import {
  KIOSK_SOP_CLOSE_MESSAGE,
  KIOSK_SOP_FOCUS_CLOSE_MESSAGE
} from './buildKioskSopSrcDoc';

import type { KioskSopView } from './types';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  view: KioskSopView;
};

export function KioskSopDialog({ isOpen, onClose, view }: Props) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      if (event.data === KIOSK_SOP_CLOSE_MESSAGE) {
        onClose();
        return;
      }
      if (event.data === KIOSK_SOP_FOCUS_CLOSE_MESSAGE) {
        closeButtonRef.current?.focus();
      }
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [isOpen, onClose]);

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel={`取説 — ${view.title} — ${view.contextLabel}`}
      closeOnBackdrop={false}
      initialFocusRef={closeButtonRef}
      size="full"
      overlayZIndex={80}
      className="!my-0 flex h-[calc(100dvh-2rem)] !max-h-[calc(100dvh-2rem)] flex-col overflow-hidden !rounded-lg !border !border-white/20 !bg-slate-950 !p-0 !text-white !shadow-none"
    >
      <header className="flex min-h-14 shrink-0 items-center gap-3 border-b border-white/15 px-3 py-1.5">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold text-white">取説 — {view.title}</h2>
          <p className="text-sm font-semibold text-white/60">{view.contextLabel}</p>
        </div>
        <Button
          ref={closeButtonRef}
          type="button"
          variant="ghostOnDark"
          className="ml-auto min-h-11 shrink-0 !px-3 text-[0.95rem]"
          onClick={onClose}
        >
          閉じる
        </Button>
      </header>

      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-slate-900">
        <iframe
          ref={frameRef}
          title={`${view.title} — ${view.contextLabel}`}
          data-testid="kiosk-sop-frame"
          className="h-full w-full border-0 bg-slate-950"
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          srcDoc={view.srcDoc}
          tabIndex={0}
        />
      </div>
    </Dialog>
  );
}
