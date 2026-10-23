import { useNavigate } from 'react-router-dom';

import { getResolvedClientKey } from '../../api/client';
import {
  BarcodeScanModal,
  BARCODE_FORMAT_PRESET_ONE_DIMENSIONAL_CORE,
  KIOSK_STANDARD_BARCODE_SCAN_SESSION,
} from '../../features/barcode-scan';
import { usePalletVisualizationController } from '../../features/kiosk/pallet-visualization';
import { PalletVizPhoneView } from '../../features/kiosk/pallet-visualization/PalletVizPhoneView';

export function KioskMobilePalletVisualizationPage() {
  const navigate = useNavigate();
  const ctrl = usePalletVisualizationController({
    clientKey: getResolvedClientKey(), enableKeyboardWedge: false, enableSerialBarcodeStream: false,
  });
  return <>
    <PalletVizPhoneView ctrl={ctrl} onBack={() => navigate('/kiosk/mobile-placement')} />
    <BarcodeScanModal
      open={ctrl.scanOpen}
      formats={BARCODE_FORMAT_PRESET_ONE_DIMENSIONAL_CORE}
      {...KIOSK_STANDARD_BARCODE_SCAN_SESSION}
      onSuccess={ctrl.handleScanSuccess}
      onAbort={() => ctrl.setScanOpen(false)}
    />
  </>;
}
