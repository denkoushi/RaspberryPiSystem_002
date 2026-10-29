import { useParams } from 'react-router-dom';

import { CheckSheetScreen } from '../../features/assembly/checkSheet/CheckSheetScreen';
export function KioskAssemblyCheckSheetPage() {
  const { sheetId } = useParams<{ sheetId: string }>();
  return sheetId ? <CheckSheetScreen key={sheetId} sheetId={sheetId} /> : null;
}
