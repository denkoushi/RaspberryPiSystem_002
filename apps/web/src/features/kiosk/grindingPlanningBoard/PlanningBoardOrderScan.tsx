import clsx from 'clsx';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useKeyboardWedgeScan } from '../../barcode-scan';
import { claimKeyboardWedgeScanOwner, releaseKeyboardWedgeScanOwner } from '../../barcode-scan/useKeyboardWedgeScan';
import { normalizeManufacturingOrderScanText } from '../../part-measurement/manufacturingOrderScan';

import { pageZoom } from './pageZoom';

const SCAN_OWNER = 'planning-board-order-scan';

type Props = {
  onScan: (productNo: string) => string | null;
};

export function PlanningBoardOrderScan({ onScan }: Props) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [position, setPosition] = useState({ left: 8, top: 8, maxWidth: 300, maxHeight: 400 });
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    button.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    claimKeyboardWedgeScanOwner(SCAN_OWNER);
    return () => releaseKeyboardWedgeScanOwner(SCAN_OWNER);
  }, [open]);
  useKeyboardWedgeScan({
    active: open,
    owner: SCAN_OWNER,
    minChars: 4,
    onScan: (raw) => {
      const productNo = normalizeManufacturingOrderScanText(raw);
      const message = productNo === null
        ? `製造order番号は数字10桁です（読取値: ${raw}）。読み直してください。`
        : onScan(productNo);
      if (message) setError(message);
      else close();
    }
  });

  // The shared Dialog is a centered modal. This non-modal anchored popup follows the toolbar scale popup.
  useEffect(() => {
    if (!open) return;
    panel.current?.focus();
    // Capture on window so Escape closes only the popup and does not also clear the seiban highlight.
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); close(); } };
    window.addEventListener('keydown', escape, true);
    return () => window.removeEventListener('keydown', escape, true);
  }, [open, close]);
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      if (!button.current || !panel.current) return;
      const zoom = pageZoom();
      const anchor = button.current.getBoundingClientRect();
      const bounds = panel.current.getBoundingClientRect();
      setPosition({
        left: Math.max(8, Math.min(anchor.left / zoom, (window.innerWidth - bounds.width) / zoom - 8)),
        top: Math.max(8, Math.min(anchor.bottom / zoom + 4, (window.innerHeight - bounds.height) / zoom - 8)),
        maxWidth: Math.max(0, window.innerWidth / zoom - 16),
        maxHeight: Math.max(0, window.innerHeight / zoom - 16)
      });
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    if (panel.current) observer?.observe(panel.current);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open, error]);

  return <>
    <button ref={button} type="button" aria-label="移動票で製番を探す" aria-haspopup="dialog" aria-pressed={open}
      onClick={() => { if (open) close(); else { setError(null); setOpen(true); } }}
      className={clsx('grid h-[46px] w-[46px] shrink-0 place-items-center rounded-md border focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300',
        open ? 'border-sky-300 bg-sky-400 text-slate-950' : 'border-slate-600 text-sky-300')}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5" aria-hidden="true">
        <path d="M7 3H3v4m14-4h4v4M3 17v4h4m14-4v4h-4M7 7v10m3-10v10m4-10v10m3-10v10" />
      </svg>
    </button>
    {open && createPortal(<div ref={panel} role="dialog" aria-label="移動票を読み取る" tabIndex={-1} style={position}
      className="fixed z-[100] w-[300px] overflow-y-auto rounded-lg border border-slate-600 bg-slate-900 p-3 text-white shadow-xl">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold">移動票を読み取る</h2>
        <button type="button" aria-label="閉じる" onClick={close} className="grid h-11 w-11 shrink-0 place-items-center rounded-md hover:bg-slate-800">✕</button>
      </div>
      <p className="flex items-center gap-2 text-sm"><span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" aria-hidden="true" />読み取り待ち</p>
      <p role="alert" className="mt-2 min-h-5 break-words text-sm text-rose-200">{error}</p>
    </div>, document.body)}
  </>;
}
