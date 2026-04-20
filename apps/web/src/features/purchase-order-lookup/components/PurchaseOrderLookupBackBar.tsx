import { useNavigate } from 'react-router-dom';

import { purchaseOrderLookupKioskTheme } from '../ui/purchaseOrderLookupKioskTheme';

/**
 * 配膳メイン（/kiosk/mobile-placement）へ戻る。
 */
export function PurchaseOrderLookupBackBar() {
  const navigate = useNavigate();
  return (
    <div className={purchaseOrderLookupKioskTheme.backBarWrap}>
      <button
        type="button"
        className={purchaseOrderLookupKioskTheme.primaryButton}
        onClick={() => navigate('/kiosk/mobile-placement')}
      >
        ← 配膳に戻る
      </button>
    </div>
  );
}
