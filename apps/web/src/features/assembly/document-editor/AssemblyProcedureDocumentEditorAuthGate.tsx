import { useNavigate } from 'react-router-dom';

import { KioskPinDialog } from '../../kiosk/KioskPinDialog';
import { KIOSK_ASSEMBLY_LIBRARY_PATH } from '../assemblyRoutes';
import { PROCEDURE_EDITOR_ACCESS_HOURS } from '../procedureEditorAccess';

import { useAssemblyProcedureDocumentEditor } from './AssemblyProcedureDocumentEditorContext';

export function AssemblyProcedureDocumentEditorAuthGate({ context }: { context?: import('../types').ProcedureManualEditorContext }) {
  const navigate = useNavigate();
  const {
    accessGranted,
    loading,
    message,
    verifyEditorPassword,
    navigateBack
  } = useAssemblyProcedureDocumentEditor();

  if (accessGranted && !loading) return null;
  if (loading) {
    return <div className="flex min-h-0 flex-1 items-center justify-center bg-slate-800 text-white">読込中…</div>;
  }

  return (
    <main className="flex min-h-0 flex-1 bg-slate-800">
      <KioskPinDialog
        validHours={PROCEDURE_EDITOR_ACCESS_HOURS}
        backLabel={context ? '戻る' : '一覧へ'}
        onBack={context ? navigateBack : () => navigate(KIOSK_ASSEMBLY_LIBRARY_PATH)}
        onSubmit={verifyEditorPassword}
        notice={message ?? undefined}
        pinTargetId="assembly-document-editor-password"
        submitTargetId="assembly-document-editor-authenticate"
      />
    </main>
  );
}
