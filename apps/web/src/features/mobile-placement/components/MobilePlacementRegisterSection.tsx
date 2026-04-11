import { Button } from '../../../components/ui/Button';
import { MOBILE_PLACEMENT_TEMP_SHELVES, MP_PLACEHOLDER_ORDER } from '../constants';
import { ViewfinderIcon } from '../icons/ViewfinderIcon';

import { IconScanButton } from './IconScanButton';

export type MobilePlacementRegisterSectionProps = {
  shelfCode: string;
  onSelectShelf: (code: string) => void;
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
 */
export function MobilePlacementRegisterSection(props: MobilePlacementRegisterSectionProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5 p-3">
      <div className="rounded-[10px] border-l-[3px] border-l-amber-400 bg-amber-500/[0.06] px-2.5 py-2.5">
        <div className="flex flex-wrap gap-2">
          {MOBILE_PLACEMENT_TEMP_SHELVES.map((code) => (
            <Button
              key={code}
              type="button"
              variant={props.shelfCode === code ? 'primary' : 'ghostOnDark'}
              className="min-h-[3rem] min-w-[4.5rem] flex-col gap-0.5 py-2 text-xs !text-white"
              aria-label={`棚 ${code}`}
              onClick={() => props.onSelectShelf(code)}
            >
              <span className="text-lg" aria-hidden>
                📦
              </span>
              <span>{code}</span>
            </Button>
          ))}
          <button
            type="button"
            className="flex min-h-[3rem] min-w-[4.5rem] flex-col items-center justify-center gap-0.5 border-0 bg-transparent py-2 text-xs text-slate-300 active:bg-white/[0.22] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/40"
            title="棚のQRコードをスキャン"
            aria-label="棚をQRスキャン"
            onClick={props.onShelfQrScan}
          >
            <ViewfinderIcon className="h-[18px] w-[18px] text-sky-300" />
            <span>QR</span>
          </button>
        </div>
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
