import clsx from 'clsx';

import { AssemblyTemplateEditorAuthGate } from './AssemblyTemplateEditorAuthGate';
import { AssemblyTemplateEditorCanvasPane } from './AssemblyTemplateEditorCanvasPane';
import { useAssemblyTemplateEditor } from './AssemblyTemplateEditorContext';
import { AssemblyTemplateEditorDialogs } from './AssemblyTemplateEditorDialogs';
import { AssemblyTemplateEditorHeader } from './AssemblyTemplateEditorHeader';
import { AssemblyTemplateEditorInspectorPane } from './AssemblyTemplateEditorInspectorPane';
import { AssemblyTemplateEditorLeftPane } from './AssemblyTemplateEditorLeftPane';

export function AssemblyTemplateEditorScreen() {
  const {
    accessGranted,
    loading,
    message,
    procedurePaneOpen,
    settingsPaneOpen
  } = useAssemblyTemplateEditor();

  if (loading || !accessGranted) return <AssemblyTemplateEditorAuthGate />;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 bg-slate-800 p-2 text-white">
      <AssemblyTemplateEditorHeader />
      {message ? (
        <p className="rounded border border-white/15 bg-slate-900/80 px-3 py-2 text-sm font-semibold text-amber-200">
          {message}
        </p>
      ) : null}
      <div
        data-testid="assembly-unified-editor-workspace"
        className={clsx(
          'grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-auto xl:overflow-hidden',
          procedurePaneOpen &&
            settingsPaneOpen &&
            'xl:grid-cols-[16rem_minmax(0,1fr)_20rem]',
          procedurePaneOpen &&
            !settingsPaneOpen &&
            'xl:grid-cols-[16rem_minmax(0,1fr)]',
          !procedurePaneOpen &&
            settingsPaneOpen &&
            'xl:grid-cols-[minmax(0,1fr)_20rem]',
          !procedurePaneOpen && !settingsPaneOpen && 'xl:grid-cols-1'
        )}
      >
        <AssemblyTemplateEditorLeftPane />
        <AssemblyTemplateEditorCanvasPane />
        <AssemblyTemplateEditorInspectorPane />
      </div>
      <AssemblyTemplateEditorDialogs />
    </div>
  );
}
