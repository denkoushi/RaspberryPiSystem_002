import { AssemblyTemplateEditorAuthGate } from './AssemblyTemplateEditorAuthGate';
import { AssemblyTemplateEditorCanvasPane } from './AssemblyTemplateEditorCanvasPane';
import { AssemblyTemplateEditorCanvasToolbar } from './AssemblyTemplateEditorCanvasToolbar';
import { useAssemblyTemplateEditor } from './AssemblyTemplateEditorContext';
import { AssemblyTemplateEditorDialogs } from './AssemblyTemplateEditorDialogs';
import { AssemblyTemplateEditorLeftPane } from './AssemblyTemplateEditorLeftPane';
import { AssemblyTemplateEditorSideColumn } from './AssemblyTemplateEditorSideColumn';
import { useAssemblyEditorWideLayout } from './useAssemblyEditorWideLayout';

export function AssemblyTemplateEditorScreen() {
  const { accessGranted, loading, message, boltConditionPaneOpen, settingsPaneOpen } = useAssemblyTemplateEditor();
  const wide = useAssemblyEditorWideLayout();
  const docked = !wide && (boltConditionPaneOpen || settingsPaneOpen);
  if (loading || !accessGranted) return <AssemblyTemplateEditorAuthGate />;

  return (
    <main
      data-testid="assembly-unified-editor-workspace"
      className={`relative grid min-h-0 flex-1 ${docked ? 'grid-cols-[280px_minmax(0,1fr)_320px_64px]' : 'grid-cols-[280px_minmax(0,1fr)_64px]'} overflow-hidden bg-[#0a0d10] text-[#eef3f6]`}
    >
      <AssemblyTemplateEditorLeftPane />
      <AssemblyTemplateEditorCanvasPane />
      <AssemblyTemplateEditorSideColumn floating={wide} />
      <AssemblyTemplateEditorCanvasToolbar />
      {message ? (
        <p role="status" className="absolute bottom-4 left-[296px] right-20 z-30 rounded border border-[#344252] bg-[#161c22] px-3 py-2 text-sm font-semibold text-amber-200">
          {message}
        </p>
      ) : null}
      <AssemblyTemplateEditorDialogs />
    </main>
  );
}
