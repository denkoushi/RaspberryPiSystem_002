import { MP_PLACEHOLDER_ORDER } from '../constants';
import { ViewfinderIcon } from '../icons/ViewfinderIcon';

import { IconScanButton } from './IconScanButton';

export type MobilePlacementRegisterSectionProps = {
  shelfCode: string;
  onOpenShelfRegister: () => void;
  onShelfQrScan: () => void;
  orderBarcode: string;
  onOrderBarcodeChange: (v: string) => void;
  onOrderScan: () => void;
  registerSubmitting: boolean;
  registerDisabled: boolean;
  onRegister: () => void;
  registerMessage: string | null;
  registerError: string | null;
};

/**
 * 下半: 仮棚（アンバーブロック）+ 製造order・登録（ティールブロック）
 * 棚番は専用ページで選択（/kiosk/mobile-placement/shelf-register）、QR は従来どおり。
 */
export function MobilePlacementRegisterSection(props: MobilePlacementRegisterSectionProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5 p-3">
      <div className="rounded-[10px] border-l-[3px] border-l-amber-400 bg-amber-500/[0.06] px-2.5 py-2.5">
        <div className="grid grid-cols-2 gap-2 [grid-template-columns:repeat(2,minmax(0,1fr))]">
          <button
            type="button"
            className="min-h-[52px] min-w-0 rounded-[10px] border border-amber-400/35 bg-slate-800 px-2 py-2 text-sm font-bold text-amber-100 active:bg-amber-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/40"
            onClick={props.onOpenShelfRegister}
          >
            棚番を選ぶ
          </button>
          <button
            type="button"
            className="flex min-h-[52px] min-w-0 flex-col items-center justify-center gap-1 border-0 bg-transparent py-2 text-xs font-semibold text-slate-300 active:bg-white/[0.22] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/40"
            title="棚のQRコードをスキャン"
            aria-label="棚をQRスキャン"
            onClick={props.onShelfQrScan}
          >
            <ViewfinderIcon className="h-[18px] w-[18px] text-sky-300" />
            <span>QR</span>
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-300">
          選択中の棚: <strong className="font-semibold text-amber-100">{props.shelfCode || '—'}</strong>
        </p>
      </div>

      <div className="rounded-[10px] border-l-[3px] border-l-teal-400 bg-teal-500/[0.06] px-2.5 py-2.5">
        <div className="flex w-full min-w-0 flex-nowrap items-center gap-1.5">
          <label className="sr-only" htmlFor="mp-order-scan">
            {MP_PLACEHOLDER_ORDER}
          </label>
          <div className="w-[calc((100%-10px)/2-46px)] min-w-0 max-w-full shrink-0">
            <input
              id="mp-order-scan"
              value={props.orderBarcode}
              onChange={(e) => props.onOrderBarcodeChange(e.target.value)}
              inputMode="numeric"
              autoComplete="off"
              placeholder={MP_PLACEHOLDER_ORDER}
              className="h-10 w-full rounded-md border border-teal-400/30 bg-slate-950 px-2.5 text-sm text-white tabular-nums placeholder:text-slate-400"
            />
          </div>
          <IconScanButton variant="order" title="スキャン" aria-label="製造orderをスキャン" onClick={props.onOrderScan} />
          <button
            type="button"
            className="h-10 shrink-0 rounded-md border border-teal-400/55 bg-gradient-to-b from-teal-400/40 to-teal-600/25 px-4 text-sm font-bold text-teal-100 disabled:cursor-not-allowed disabled:opacity-45"
            disabled={props.registerDisabled}
            onClick={props.onRegister}
          >
            {props.registerSubmitting ? '登録中…' : '登録'}
          </button>
        </div>
      </div>

      {props.registerMessage ? (
        <p className="text-sm text-emerald-200" role="status">
          {props.registerMessage}
        </p>
      ) : null}
      {props.registerError ? (
        <p className="text-sm text-red-200" role="alert">
          {props.registerError}
        </p>
      ) : null}

      <p className="text-center text-[11px] text-slate-400">照合OK → 棚 → 製造order → 登録</p>
    </div>
  );
}
