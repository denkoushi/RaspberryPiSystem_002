import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';

import { kioskAssemblyLibraryPath, kioskAssemblyManualsPath } from '../assemblyRoutes';

import { AssemblyProcedureDocumentEditorProvider } from './AssemblyProcedureDocumentEditorContext';
import { AssemblyProcedureDocumentEditorScreen } from './AssemblyProcedureDocumentEditorScreen';
import { useAssemblyProcedureDocumentEditorController } from './useAssemblyProcedureDocumentEditorController';

import type { ProcedureManualEditorContext } from '../types';

function isProcedureManualEditorContext(value: unknown): value is ProcedureManualEditorContext {
  if (typeof value !== 'object' || value === null) return false;
  return 'modelCode' in value && typeof value.modelCode === 'string' &&
    'modelCodeKey' in value && typeof value.modelCodeKey === 'string' &&
    'processId' in value && typeof value.processId === 'string' &&
    'processName' in value && typeof value.processName === 'string' &&
    'mode' in value && (value.mode === 'fix' || value.mode === 'make');
}

function normalizeReturnTo(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value, window.location.origin);
    return url.origin === window.location.origin && url.pathname.startsWith('/kiosk/') ? url.pathname + url.search : null;
  } catch { return null; }
}

export function AssemblyProcedureDocumentEditorPage() {
  const { documentId } = useParams<{ documentId: string }>();
  if (!documentId) return <Navigate to={kioskAssemblyLibraryPath({ focus: 'procedures' })} replace />;
  return <AssemblyProcedureDocumentEditorRoute documentId={documentId} />;
}

function AssemblyProcedureDocumentEditorRoute({ documentId }: { documentId: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as { procedureManualAssignmentError?: unknown; returnTo?: unknown; context?: unknown } | null;
  const assignmentError = state?.procedureManualAssignmentError;
  const returnTo = normalizeReturnTo(state?.returnTo);
  const fallback = kioskAssemblyLibraryPath({ focus: 'procedures' });
  const controller = useAssemblyProcedureDocumentEditorController({
    documentId,
    onNavigateBack: () => navigate(returnTo ?? fallback, { replace: true }),
    onNavigateAfterDelete: () => navigate(returnTo ?? kioskAssemblyManualsPath(), { replace: true }),
    onNavigateAfterDiscard: () => navigate(returnTo ?? fallback, { replace: true }),
    onNavigateAfterPublish: () => navigate(returnTo ?? fallback, { replace: true })
  });
  return (
    <AssemblyProcedureDocumentEditorProvider value={controller}>
      {typeof assignmentError === 'string' ? <p className="shrink-0 border-b border-amber-400/30 bg-amber-500/15 px-3 py-2 text-sm text-amber-100" role="alert">{assignmentError}</p> : null}
      <AssemblyProcedureDocumentEditorScreen context={isProcedureManualEditorContext(state?.context) ? state.context : undefined} />
    </AssemblyProcedureDocumentEditorProvider>
  );
}
