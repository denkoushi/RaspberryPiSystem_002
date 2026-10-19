import { AssemblyBoltConditionStrip } from '../AssemblyBoltConditionStrip';

import { useAssemblyTemplateEditor } from './AssemblyTemplateEditorContext';
import { AssemblyTemplateEditorInspectorPane } from './AssemblyTemplateEditorInspectorPane';

export function AssemblyTemplateEditorSideColumn({ floating }: { floating: boolean }) {
  const {
    activeBoltConditionKey, addBoltCondition, boltConditionPalette,
    boltConditionPaneOpen, readOnly, selectBoltCondition, selectedBolt,
    setBoltConditionPaneOpen, settingsPaneOpen
  } = useAssemblyTemplateEditor();
  if (!boltConditionPaneOpen && !settingsPaneOpen) return null;
  return (
    <aside data-testid="assembly-editor-side-column" aria-label="テンプレート設定" className={`flex min-h-0 min-w-0 flex-col overflow-y-auto border border-[#344252] bg-[#161c22] ${floating ? 'absolute bottom-4 right-20 top-14 z-30 w-80 rounded-lg shadow-xl' : 'w-[320px]'}`}>
      {boltConditionPaneOpen ? <div className="border-b border-[#27313b] p-2.5">
        <button type="button" aria-label="締付条件を閉じる" className="mb-2 block min-h-8 w-full text-right text-sm" onClick={() => setBoltConditionPaneOpen(false)}>×</button>
        <AssemblyBoltConditionStrip orientation="column" entries={boltConditionPalette} activeKey={activeBoltConditionKey} selectedMarkerNo={selectedBolt?.markerNo ?? null} readOnly={readOnly} onSelect={selectBoltCondition} onAdd={addBoltCondition} />
      </div> : null}
      {settingsPaneOpen ? <AssemblyTemplateEditorInspectorPane embedded /> : null}
    </aside>
  );
}
