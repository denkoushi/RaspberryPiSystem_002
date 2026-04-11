import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { BarcodeScanModal } from '../../features/barcode-scan/BarcodeScanModal';
import { MobilePlacementRegisterSection } from '../../features/mobile-placement/components/MobilePlacementRegisterSection';
import { MobilePlacementVerifySection } from '../../features/mobile-placement/components/MobilePlacementVerifySection';
import { isMobilePlacementShelfRegisterRouteState } from '../../features/mobile-placement/shelfSelection';
import { useMobilePlacementPageState } from '../../features/mobile-placement/useMobilePlacementPageState';

export function MobilePlacementPage() {
  const mp = useMobilePlacementPageState();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isMobilePlacementShelfRegisterRouteState(location.state)) return;
    mp.restoreShelfRegisterRouteState(location.state);
    navigate(location.pathname, { replace: true, state: undefined });
    // mp の restore 関数のみ使用（安定）。location を依存に含め戻り state を一度だけ反映する。
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mp 全体を入れると再実行が増える
  }, [location.state, location.pathname, mp.restoreShelfRegisterRouteState, navigate]);

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
        onOpenShelfRegister={() =>
          navigate('/kiosk/mobile-placement/shelf-register', {
            state: mp.buildShelfRegisterRouteState()
          })
        }
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
