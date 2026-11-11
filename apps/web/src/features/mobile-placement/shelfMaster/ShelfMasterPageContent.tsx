import { useIsPhoneViewport } from '../ui/useIsPhoneViewport';

import { ShelfMasterPhonePage } from './components/ShelfMasterPhonePage';
import { ShelfMasterKioskPage } from './kiosk/ShelfMasterKioskPage';

export function ShelfMasterPageContent() {
  return useIsPhoneViewport() ? <ShelfMasterPhonePage /> : <ShelfMasterKioskPage />;
}
