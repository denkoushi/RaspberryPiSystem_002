import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { BarcodeScanModal } from '../../features/barcode-scan/BarcodeScanModal';
import { MobilePlacementRegisterSection } from '../../features/mobile-placement/components/MobilePlacementRegisterSection';
import { MobilePlacementVerifySection } from '../../features/mobile-placement/components/MobilePlacementVerifySection';
import { isMobilePlacementShelfRegisterRouteState } from '../../features/mobile-placement/shelfSelection';
import { useMobilePlacementPageState } from '../../features/mobile-placement/useMobilePlacementPageState';
import { useRegisteredShelves } from '../../features/mobile-placement/useRegisteredShelves';

export function MobilePlacementPage() {
  const mp = useMobilePlacementPageState();
  const registeredShelvesQuery = useRegisteredShelves();
  const location = useLocation();
  const navigate = useNavigate();
  const actualSlipFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isMobilePlacementShelfRegisterRouteState(location.state)) return;
    mp.restoreShelfRegisterRouteState(location.state);
    navigate(location.pathname, { replace: true, state: undefined });
    // mp の restore 関数のみ使用（安定）。location を依存に含め戻り state を一度だけ反映する。
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mp 全体を入れると再実行が増える
  }, [location.state, location.pathname, mp.restoreShelfRegisterRouteState, navigate]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <input
        ref={actualSlipFileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        className="sr-only"
        aria-hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void mp.parseActualSlipImageFile(f);
          e.target.value = '';
        }}
      />
      <BarcodeScanModal
        open={mp.scanField !== null}
        formats={mp.scanFormats}
        idleTimeoutMs={30_000}
        onSuccess={mp.onScanSuccess}
        onAbort={() => mp.setScanField(null)}
      />

      <MobilePlacementVerifySection
        transferOrder={mp.transferOrder}
        transferPart={mp.transferPart}
        actualOrder={mp.actualOrder}
        actualFseiban={mp.actualFseiban}
        actualPart={mp.actualPart}
        onChangeTransferOrder={(v) => {
          mp.setTransferOrder(v);
          mp.resetSlipResult();
        }}
        onChangeTransferPart={(v) => {
          mp.setTransferPart(v);
          mp.resetSlipResult();
        }}
        onChangeActualOrder={(v) => {
          mp.setActualOrder(v);
          mp.resetSlipResult();
        }}
        onChangeActualFseiban={(v) => {
          mp.setActualFseiban(v);
          mp.resetSlipResult();
        }}
        onChangeActualPart={(v) => {
          mp.setActualPart(v);
          mp.resetSlipResult();
        }}
        onScanTransferOrder={() => mp.setScanField('transferOrder')}
        onScanTransferPart={() => mp.setScanField('transferPart')}
        onScanActualOrder={() => mp.setScanField('actualOrder')}
        onScanActualPart={() => mp.setScanField('actualPart')}
        onPickActualSlipImage={() => actualSlipFileInputRef.current?.click()}
        actualSlipImageOcrBusy={mp.actualSlipImageOcrBusy}
        slipVerifying={mp.slipVerifying}
        slipResult={mp.slipResult}
        onVerify={() => void mp.runSlipVerify()}
      />

      <MobilePlacementRegisterSection
        shelfCode={mp.shelfCode}
        onSelectShelf={mp.selectShelf}
        onOpenShelfRegister={() =>
          navigate('/kiosk/mobile-placement/shelf-register', {
            state: mp.buildShelfRegisterRouteState()
          })
        }
        onShelfQrScan={() => mp.setScanField('shelf')}
        registeredShelves={registeredShelvesQuery.data?.shelves ?? []}
        registeredShelvesLoading={registeredShelvesQuery.isLoading}
        registeredShelvesError={registeredShelvesQuery.isError}
        onRetryRegisteredShelves={() => void registeredShelvesQuery.refetch()}
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
