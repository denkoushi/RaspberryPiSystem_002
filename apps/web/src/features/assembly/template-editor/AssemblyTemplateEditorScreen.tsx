import clsx from 'clsx';

import { AssemblyTemplateEditorAuthGate } from './AssemblyTemplateEditorAuthGate';
import { AssemblyTemplateEditorCanvasPane } from './AssemblyTemplateEditorCanvasPane';
import { useAssemblyTemplateEditor } from './AssemblyTemplateEditorContext';
import { AssemblyTemplateEditorDialogs } from './AssemblyTemplateEditorDialogs';
import { AssemblyTemplateEditorHeader } from './AssemblyTemplateEditorHeader';
import { AssemblyTemplateEditorInspectorPane } from './AssemblyTemplateEditorInspectorPane';
import { AssemblyTemplateEditorLeftPane } from './AssemblyTemplateEditorLeftPane';
import { AssemblyTemplateEditorSideColumn } from './AssemblyTemplateEditorSideColumn';
import { useAssemblyEditorWideLayout } from './useAssemblyEditorWideLayout';

export function AssemblyTemplateEditorScreen() {
  const {
    accessGranted,
    loading,
    message,
    procedurePaneOpen,
    settingsPaneOpen
  } = useAssemblyTemplateEditor();
  const wide = useAssemblyEditorWideLayout();

  if (loading || !accessGranted) return <AssemblyTemplateEditorAuthGate />;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5 bg-[#0f1317] p-1.5 text-white">
      <AssemblyTemplateEditorHeader />
      {message ? (
        <p className="rounded border border-[#27313b] bg-[#161c22] px-3 py-1.5 text-sm font-semibold text-amber-200">
          {message}
        </p>
      ) : null}
      <div
        data-testid="assembly-unified-editor-workspace"
        className={clsx(
          'grid min-h-0 flex-1 grid-cols-1 gap-1.5 overflow-auto xl:overflow-hidden',
          // 広い画面: 右の列は常に出す。左の幅は切替で中央が動かないよう一定にする。
          wide && procedurePaneOpen && '2xl:grid-cols-[16rem_minmax(0,1fr)_20rem]',
          wide && !procedurePaneOpen && '2xl:grid-cols-[minmax(0,1fr)_20rem]',
          !wide &&
            procedurePaneOpen &&
            settingsPaneOpen &&
            'xl:grid-cols-[16rem_minmax(0,1fr)_20rem]',
          !wide &&
            procedurePaneOpen &&
            !settingsPaneOpen &&
            'xl:grid-cols-[16rem_minmax(0,1fr)]',
          !wide &&
            !procedurePaneOpen &&
            settingsPaneOpen &&
            'xl:grid-cols-[minmax(0,1fr)_20rem]',
          !wide && !procedurePaneOpen && !settingsPaneOpen && 'xl:grid-cols-1'
        )}
      >
        <AssemblyTemplateEditorLeftPane />
        <AssemblyTemplateEditorCanvasPane />
        {wide ? <AssemblyTemplateEditorSideColumn /> : <AssemblyTemplateEditorInspectorPane />}
      </div>
      <AssemblyTemplateEditorDialogs />
    </div>
  );
}
