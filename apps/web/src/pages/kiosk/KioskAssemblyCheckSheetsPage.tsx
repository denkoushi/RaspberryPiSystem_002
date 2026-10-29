import { Link } from 'react-router-dom';

import { buttonClassName } from '../../components/ui/Button';
import { KIOSK_ASSEMBLY_HOME_PATH } from '../../features/assembly/assemblyRoutes';
import { CheckSheetLibraryPage } from '../../features/assembly/checkSheet/CheckSheetLibraryPage';

export function KioskAssemblyCheckSheetsPage() {
  return <div className="min-w-0 space-y-4 p-4">
    <Link to={KIOSK_ASSEMBLY_HOME_PATH} className={buttonClassName('ghostOnDark', 'inline-flex min-h-12 items-center')}>組立へ戻る</Link>
    <CheckSheetLibraryPage />
  </div>;
}
