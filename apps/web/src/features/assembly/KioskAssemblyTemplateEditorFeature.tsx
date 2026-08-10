import { useMemo } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';

import {
  kioskAssemblyLibraryPath,
  parseAssemblyTemplateNewSearch
} from './assemblyRoutes';
import { AssemblyTemplateEditorProvider } from './template-editor/AssemblyTemplateEditorContext';
import { AssemblyTemplateEditorScreen } from './template-editor/AssemblyTemplateEditorScreen';
import { useAssemblyTemplateEditorController } from './template-editor/useAssemblyTemplateEditorController';

export function KioskAssemblyTemplateEditorPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { templateId } = useParams<{ templateId?: string }>();
  const query = useMemo(
    () => parseAssemblyTemplateNewSearch(location.search),
    [location.search]
  );
  const controller = useAssemblyTemplateEditorController({
    onSaved: (saved) =>
      navigate(kioskAssemblyLibraryPath({ focus: 'templates', modelCode: saved.modelCode }), {
        replace: true,
        state: {
          assemblyTemplateSaved: {
            id: saved.id,
            modelCode: saved.modelCode,
            procedurePattern: saved.procedurePattern,
            version: saved.version
          }
        }
      }),
    query,
    templateId
  });

  return (
    <AssemblyTemplateEditorProvider
      value={controller}
      renderLink={({ children, className, to }) => (
        <Link className={className} to={to}>
          {children}
        </Link>
      )}
    >
      <AssemblyTemplateEditorScreen />
    </AssemblyTemplateEditorProvider>
  );
}
