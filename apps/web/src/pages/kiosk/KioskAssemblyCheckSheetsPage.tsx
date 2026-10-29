import { Link } from 'react-router-dom';

import { buttonClassName } from '../../components/ui/Button';
import { KIOSK_ASSEMBLY_HOME_PATH } from '../../features/assembly/assemblyRoutes';
import { CheckSheetLibraryPage } from '../../features/assembly/checkSheet/CheckSheetLibraryPage';

export function KioskAssemblyCheckSheetsPage() {
  return <CheckSheetLibraryPage backLink={
    <Link to={KIOSK_ASSEMBLY_HOME_PATH} className={buttonClassName('ghostOnDark', 'inline-flex h-[60px] shrink-0 items-center px-6 text-[22px]')}>組立へ戻る</Link>
  } />;
}
