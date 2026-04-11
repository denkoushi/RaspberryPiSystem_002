import { MP_PLACEHOLDER_ORDER } from '../constants';
import { useShelfZoneOverlay } from '../hooks/useShelfZoneOverlay';
import { DEFAULT_SHELF_ZONE_CATALOG } from '../shelfZones/defaultShelfZoneCatalog';

import { IconScanButton } from './IconScanButton';
import { ShelfZoneOverlay } from './ShelfZoneOverlay';
import { ShelfZonePickerRow } from './ShelfZonePickerRow';

import type { ShelfZoneCatalog } from '../shelfZones/shelfZoneTypes';

export type MobilePlacementRegisterSectionProps = {
  shelfCode: string;
  onSelectShelf: (code: string) => void;
  onShelfQrScan: () => void;
  /** 省略時はダミー catalog。将来 API 結果を渡して差し替え可能 */
  shelfZoneCatalog?: ShelfZoneCatalog;
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
  const catalog = props.shelfZoneCatalog ?? DEFAULT_SHELF_ZONE_CATALOG;
  const zoneUi = useShelfZoneOverlay(catalog);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5 p-3">
      <ShelfZoneOverlay
        open={zoneUi.activeZone !== null}
        zone={zoneUi.activeZone}
        selectedShelfCode={props.shelfCode}
        onClose={zoneUi.closeZone}
        onSelectShelf={props.onSelectShelf}
      />

      <div className="rounded-[10px] border-l-[3px] border-l-amber-400 bg-amber-500/[0.06] px-2.5 py-2.5">
        <ShelfZonePickerRow
          zones={catalog.zones}
          onOpenZone={zoneUi.openZone}
          onQrScan={props.onShelfQrScan}
        />
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
