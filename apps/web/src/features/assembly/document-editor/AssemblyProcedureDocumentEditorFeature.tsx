import { Navigate, useNavigate, useParams } from 'react-router-dom';

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
  const controller = useAssemblyProcedureDocumentEditorController({
    documentId,
    onNavigateBack: () => navigate(kioskAssemblyLibraryPath({ focus: 'procedures' }), { replace: true }),
    onNavigateAfterDiscard: () => navigate(kioskAssemblyLibraryPath({ focus: 'procedures' }), { replace: true }),
    onNavigateAfterPublish: () => navigate(kioskAssemblyLibraryPath({ focus: 'procedures' }), { replace: true })
  });
  return (
    <AssemblyProcedureDocumentEditorProvider value={controller}>
      <AssemblyProcedureDocumentEditorScreen />
    </AssemblyProcedureDocumentEditorProvider>
  );
}
