import { BarcodeScanModal } from '../../features/barcode-scan/BarcodeScanModal';
import { BARCODE_FORMAT_PRESET_ONE_DIMENSIONAL } from '../../features/barcode-scan/formatPresets';
import {
  PurchaseOrderLookupBackBar,
  PurchaseOrderLookupResultList,
  purchaseOrderLookupKioskTheme,
  usePurchaseOrderLookup
} from '../../features/purchase-order-lookup';

export function PurchaseOrderLookupPage() {
  const mp = usePurchaseOrderLookup();

  const statusText = mp.loading
    ? '照会中…'
    : mp.error != null
      ? mp.error
      : mp.result != null
        ? `照会完了 — ${mp.result.purchaseOrderNo}`
        : '';

  const statusClass = mp.loading
    ? purchaseOrderLookupKioskTheme.statusLoading
    : mp.error != null
      ? purchaseOrderLookupKioskTheme.statusErr
      : mp.result != null
        ? purchaseOrderLookupKioskTheme.statusOk
        : 'min-h-[1.25rem]';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PurchaseOrderLookupBackBar />

      <div className={purchaseOrderLookupKioskTheme.panelRoot}>
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            inputMode="numeric"
            className={purchaseOrderLookupKioskTheme.orderInput}
            placeholder="0000000000"
            value={mp.orderNo}
            onChange={(e) => mp.onOrderNoChange(e.target.value)}
            maxLength={10}
            autoComplete="off"
            aria-label="注文番号10桁"
          />
          <button
            type="button"
            className={purchaseOrderLookupKioskTheme.primaryButton}
            onClick={() => mp.setScanOpen(true)}
          >
            スキャン
          </button>
        </div>

        <p className={purchaseOrderLookupKioskTheme.hintAuto}>
          手入力で10桁そろったときも<strong>自動照会</strong>します。
        </p>

        <div className={statusClass} aria-live="polite">
          {statusText}
        </div>

        {mp.result != null ? (
          <div className={purchaseOrderLookupKioskTheme.resultShell}>
            <PurchaseOrderLookupResultList data={mp.result} />
          </div>
        ) : null}
      </div>

      <BarcodeScanModal
        open={mp.scanOpen}
        formats={BARCODE_FORMAT_PRESET_ONE_DIMENSIONAL}
        idleTimeoutMs={30_000}
        onSuccess={mp.onScanSuccess}
        onAbort={() => mp.setScanOpen(false)}
      />
    </div>
  );
}
