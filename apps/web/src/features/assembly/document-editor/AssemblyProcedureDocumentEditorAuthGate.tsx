import { useNavigate } from 'react-router-dom';

import { KIOSK_ASSEMBLY_LIBRARY_PATH } from '../assemblyRoutes';

import { useAssemblyProcedureDocumentEditor } from './AssemblyProcedureDocumentEditorContext';

export function AssemblyProcedureDocumentEditorAuthGate({ context }: { context?: import('../types').ProcedureManualEditorContext }) {
  const navigate = useNavigate();
  const {
    accessGranted,
    loading,
    message,
    navigateBack
  } = useAssemblyProcedureDocumentEditor();

  if (accessGranted && !loading) return null;
  if (loading) {
    return <div className="flex min-h-0 flex-1 items-center justify-center bg-slate-800 text-white">読込中…</div>;
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 bg-slate-800 text-white">
      {message ? <p role="alert" className="text-center text-sm text-amber-200">{message}</p> : null}
      <button type="button" onClick={context ? navigateBack : () => navigate(KIOSK_ASSEMBLY_LIBRARY_PATH)} className="min-h-11 rounded-lg border border-[#344252] px-4 text-[19px] font-bold text-[#eef3f6]">{context ? '戻る' : '一覧へ'}</button>
    </main>
  );
}
