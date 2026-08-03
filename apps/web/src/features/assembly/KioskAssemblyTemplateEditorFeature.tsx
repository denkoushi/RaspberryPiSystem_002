import { useMemo } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';

import {
  kioskAssemblyTemplateEditPath,
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
    onSaved: (savedId) =>
      navigate(kioskAssemblyTemplateEditPath(savedId), { replace: true }),
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
