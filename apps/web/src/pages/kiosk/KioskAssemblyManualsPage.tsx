import { Link } from 'react-router-dom';

import { ProcedureManualBrowser } from '../../features/assembly/procedure-manuals/ProcedureManualBrowser';

export function KioskAssemblyManualsPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#0f1317] text-[#eef3f6]">
      <header className="flex min-h-12 shrink-0 items-center justify-between border-b border-[#27313b] bg-[#161c22] px-3.5">
        <h1 className="text-lg font-black tracking-widest">要領書</h1>
        <Link to="/kiosk/assembly" className="inline-flex min-h-9 items-center rounded-md px-2.5 text-sm font-bold text-[#9fadb9] hover:bg-[#1f2730]">組立へ戻る</Link>
      </header>
      <ProcedureManualBrowser />
    </div>
  );
}
