import { AssemblyBoltConditionStrip } from '../AssemblyBoltConditionStrip';

import { useAssemblyTemplateEditor } from './AssemblyTemplateEditorContext';
import { AssemblyTemplateEditorInspectorPane } from './AssemblyTemplateEditorInspectorPane';

/** 広い画面で常に出す右の列。上に締付条件、下に選択中の丸数字・手順の設定を置く。 */
export function AssemblyTemplateEditorSideColumn() {
  const {
    activeBoltConditionKey,
    addBoltCondition,
    boltConditionPalette,
    readOnly,
    selectBoltCondition,
    selectedBolt,
    settingsPaneOpen
  } = useAssemblyTemplateEditor();
  return (
    <aside
      data-testid="assembly-editor-side-column"
      className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded border border-[#27313b] bg-[#161c22]"
    >
      <div className="shrink-0 border-b border-[#27313b] p-2.5">
        <AssemblyBoltConditionStrip
          orientation="column"
          entries={boltConditionPalette}
          activeKey={activeBoltConditionKey}
          selectedMarkerNo={selectedBolt?.markerNo ?? null}
          readOnly={readOnly}
          onSelect={selectBoltCondition}
          onAdd={addBoltCondition}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        {settingsPaneOpen ? (
          <AssemblyTemplateEditorInspectorPane embedded />
        ) : (
          <p className="p-3 text-xs text-white/50">丸数字／手順を選ぶと設定が出ます</p>
        )}
      </div>
    </aside>
  );
}
