import { BarcodeScanModal } from '../../features/barcode-scan/BarcodeScanModal';
import { MobilePlacementRegisterSection } from '../../features/mobile-placement/components/MobilePlacementRegisterSection';
import { MobilePlacementVerifySection } from '../../features/mobile-placement/components/MobilePlacementVerifySection';
import { useMobilePlacementPageState } from '../../features/mobile-placement/useMobilePlacementPageState';

export function MobilePlacementPage() {
  const mp = useMobilePlacementPageState();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <BarcodeScanModal
        open={mp.scanField !== null}
        formats={mp.scanFormats}
        idleTimeoutMs={30_000}
        onSuccess={mp.onScanSuccess}
        onAbort={() => mp.setScanField(null)}
      />

      <MobilePlacementVerifySection
        transferOrder={mp.transferOrder}
        transferFhinmei={mp.transferFhinmei}
        actualOrder={mp.actualOrder}
        actualFhinmei={mp.actualFhinmei}
        onChangeTransferOrder={(v) => {
          mp.setTransferOrder(v);
          mp.resetSlipResult();
        }}
        onChangeTransferFhinmei={(v) => {
          mp.setTransferFhinmei(v);
          mp.resetSlipResult();
        }}
        onChangeActualOrder={(v) => {
          mp.setActualOrder(v);
          mp.resetSlipResult();
        }}
        onChangeActualFhinmei={(v) => {
          mp.setActualFhinmei(v);
          mp.resetSlipResult();
        }}
        onScanTransferOrder={() => mp.setScanField('transferOrder')}
        onScanTransferFhinmei={() => mp.setScanField('transferFhinmei')}
        onScanActualOrder={() => mp.setScanField('actualOrder')}
        onScanActualFhinmei={() => mp.setScanField('actualFhinmei')}
        slipVerifying={mp.slipVerifying}
        slipResult={mp.slipResult}
        onVerify={() => void mp.runSlipVerify()}
      />

      <MobilePlacementRegisterSection
        shelfCode={mp.shelfCode}
        onSelectShelf={mp.selectShelf}
        onShelfQrScan={() => mp.setScanField('shelf')}
        orderBarcode={mp.orderBarcode}
        onOrderBarcodeChange={mp.setOrderBarcode}
        onOrderScan={() => mp.setScanField('order')}
        registerSubmitting={mp.registerSubmitting}
        registerDisabled={mp.registerDisabled}
        onRegister={() => void mp.runRegister()}
        registerMessage={mp.registerMessage}
        registerError={mp.registerError}
      />
    </div>
  );
}
