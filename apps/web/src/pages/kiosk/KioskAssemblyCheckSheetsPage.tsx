import { Link } from 'react-router-dom';

import { buttonClassName } from '../../components/ui/Button';
import { KIOSK_ASSEMBLY_HOME_PATH } from '../../features/assembly/assemblyRoutes';
import { CheckSheetLibraryPage } from '../../features/assembly/checkSheet/CheckSheetLibraryPage';

export function KioskAssemblyCheckSheetsPage() {
  return <CheckSheetLibraryPage backLink={
    <Link to={KIOSK_ASSEMBLY_HOME_PATH} className={buttonClassName('ghostOnDark', 'inline-flex h-9 shrink-0 items-center !px-3 !py-0 text-base')}>組立へ戻る</Link>
  } />;
}
