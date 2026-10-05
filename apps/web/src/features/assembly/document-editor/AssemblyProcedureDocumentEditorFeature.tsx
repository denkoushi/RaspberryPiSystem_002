import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';

import { kioskAssemblyLibraryPath } from '../assemblyRoutes';

import { AssemblyProcedureDocumentEditorProvider } from './AssemblyProcedureDocumentEditorContext';
import { AssemblyProcedureDocumentEditorScreen } from './AssemblyProcedureDocumentEditorScreen';
import { useAssemblyProcedureDocumentEditorController } from './useAssemblyProcedureDocumentEditorController';

export function AssemblyProcedureDocumentEditorPage() {
  const { documentId } = useParams<{ documentId: string }>();
  if (!documentId) return <Navigate to={kioskAssemblyLibraryPath({ focus: 'procedures' })} replace />;
  return <AssemblyProcedureDocumentEditorRoute documentId={documentId} />;
}

function AssemblyProcedureDocumentEditorRoute({ documentId }: { documentId: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const assignmentError = (location.state as { procedureManualAssignmentError?: unknown } | null)?.procedureManualAssignmentError;
  const controller = useAssemblyProcedureDocumentEditorController({
    documentId,
    onNavigateBack: () => navigate(kioskAssemblyLibraryPath({ focus: 'procedures' }), { replace: true }),
    onNavigateAfterDiscard: () => navigate(kioskAssemblyLibraryPath({ focus: 'procedures' }), { replace: true }),
    onNavigateAfterPublish: () => navigate(kioskAssemblyLibraryPath({ focus: 'procedures' }), { replace: true })
  });
  return (
    <AssemblyProcedureDocumentEditorProvider value={controller}>
      {typeof assignmentError === 'string' ? <p className="shrink-0 border-b border-amber-400/30 bg-amber-500/15 px-3 py-2 text-sm text-amber-100" role="alert">{assignmentError}</p> : null}
      <AssemblyProcedureDocumentEditorScreen />
    </AssemblyProcedureDocumentEditorProvider>
  );
}
