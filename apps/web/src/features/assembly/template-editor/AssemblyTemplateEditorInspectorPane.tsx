import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import {
  clearImageMarkerCalloutTip,
  ImageMarkerPositionNudge,
  imageMarkerHasCalloutTip
} from '../../kiosk/image-canvas';
import { AssemblyProcedureStepInspector } from '../AssemblyProcedureStepInspector';
import { AssemblyTemplateBoltInspector } from '../AssemblyTemplateBoltInspector';
import { pageRefKey } from '../assemblyTemplateDraft';

import { useAssemblyTemplateEditor } from './AssemblyTemplateEditorContext';

export function AssemblyTemplateEditorInspectorPane() {
  const {
    applySelectedConditionToRange,
    busy,
    capabilityCatalogStatus,
    capabilityGroups,
    currentPageRef,
    inheritCondition,
    inspectorMode,
    markerMode,
    markerSettingsOpen,
    patchProcedureStep,
    rangeEnd,
    rangeStart,
    readOnly,
    reloadCapabilityCatalog,
    reloadTorqueWrenchProfiles,
    requestDeleteSelectedBolt,
    requestDeleteSelectedCheckItem,
    selectedBolt,
    selectedCheckItem,
    selectedPage,
    selectedStep,
    selectedStepPage,
    setBoltPatch,
    setCheckItemPatch,
    setInheritCondition,
    setInspectorMode,
    setRangeEnd,
    setRangeStart,
    setShowFullPage,
    settingsPaneOpen,
    showFullPage,
    torqueWrenchProfiles,
    torqueWrenchProfilesStatus
  } = useAssemblyTemplateEditor();
  return settingsPaneOpen ? (
  <section
    id="assembly-editor-settings-pane"
    data-testid="assembly-editor-settings-pane"
    className="min-h-[32rem] min-w-0 overflow-x-hidden overflow-y-auto rounded border border-white/15 bg-slate-900/70 p-3 xl:min-h-0"
  >
    <div className="mb-3 grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-1 border-b border-white/10 pb-2">
      <Button
        type="button"
        variant={inspectorMode === 'step' ? 'primary' : 'ghostOnDark'}
        className="min-h-10 !px-1 text-xs"
        disabled={!selectedStep}
        onClick={() => setInspectorMode('step')}
      >
        手順指示
      </Button>
      <Button
        type="button"
        variant={inspectorMode === 'markers' ? 'primary' : 'ghostOnDark'}
        className="min-h-10 !px-1 text-xs"
        disabled={!markerSettingsOpen}
        onClick={() => setInspectorMode('markers')}
      >
        丸数字／チェック設定
      </Button>
      <Button
        type="button"
        variant="ghostOnDark"
        aria-label="設定を閉じる"
        className="min-h-10 !px-2 text-xs"
        onClick={() => setInspectorMode('closed')}
      >
        ×
      </Button>
    </div>
    {inspectorMode === 'step' && selectedStep ? (
      <AssemblyProcedureStepInspector
        step={selectedStep}
        page={selectedStepPage}
        readOnly={readOnly || busy}
        showFullPage={showFullPage}
        onShowFullPageChange={setShowFullPage}
        onPatch={(patch) => patchProcedureStep(selectedStep.localId, patch)}
      />
    ) : markerMode === 'bolt' ? (
      <AssemblyTemplateBoltInspector
        bolt={selectedBolt}
        pageLabel={
          selectedPage && currentPageRef ? pageRefKey(currentPageRef) : '未設定'
        }
        capabilityGroups={capabilityGroups}
        capabilityCatalogStatus={capabilityCatalogStatus}
        torqueWrenchProfiles={torqueWrenchProfiles}
        torqueWrenchProfilesStatus={torqueWrenchProfilesStatus}
        busy={busy}
        readOnly={readOnly}
        inheritCondition={inheritCondition}
        rangeStart={rangeStart}
        rangeEnd={rangeEnd}
        onPatch={setBoltPatch}
        onDelete={requestDeleteSelectedBolt}
        onInheritConditionChange={setInheritCondition}
        onRangeStartChange={setRangeStart}
        onRangeEndChange={setRangeEnd}
        onApplyRange={applySelectedConditionToRange}
        onRetryCapabilityCatalog={reloadCapabilityCatalog}
        onRetryTorqueWrenchProfiles={reloadTorqueWrenchProfiles}
      />
    ) : (
      <>
        <div className="flex min-w-0 items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-[1.02rem] font-bold">チェック項目</h2>
            {selectedCheckItem ? <div className="mt-1 truncate text-sm font-bold">チェック {selectedCheckItem.markerNo}</div> : null}
          </div>
          {selectedCheckItem ? (
            <Button type="button" variant="danger" className="min-h-8 shrink-0 !px-2 !py-1 text-xs" disabled={busy || readOnly} onClick={requestDeleteSelectedCheckItem}>
              削除
            </Button>
          ) : null}
        </div>
        {selectedCheckItem ? (
          <div className="mt-3 grid min-w-0 gap-3">
            <div className="flex min-h-9 items-center justify-between gap-2 rounded border border-white/10 bg-slate-950/60 px-2">
              <span className="text-xs font-semibold text-white/70">
                {imageMarkerHasCalloutTip(selectedCheckItem) ? '矢視 あり' : '矢視 なし'}
              </span>
              <Button
                type="button"
                variant="ghostOnDark"
                className="min-h-8 !px-2 !py-1 text-xs"
                disabled={busy || readOnly || !imageMarkerHasCalloutTip(selectedCheckItem)}
                onClick={() => setCheckItemPatch(selectedCheckItem.id, clearImageMarkerCalloutTip())}
              >
                矢視削除
              </Button>
            </div>
            <ImageMarkerPositionNudge
              position={selectedCheckItem}
              disabled={busy || readOnly}
              groupLabel="チェックマーカーの位置調整"
              className="min-w-0 [&>button]:min-w-0 [&>button]:flex-1"
              onChange={(patch) => setCheckItemPatch(selectedCheckItem.id, patch)}
            />
            <label className="grid min-w-0 gap-1 text-xs font-semibold text-white/70">
              ラベル
              <Input
                className="min-w-0"
                value={selectedCheckItem.label ?? ''}
                disabled={busy || readOnly}
                onChange={(e) => setCheckItemPatch(selectedCheckItem.id, { label: e.target.value })}
              />
            </label>
            <label className="flex min-h-10 items-center gap-2 text-xs font-semibold text-white/80">
              <input
                type="checkbox"
                checked={selectedCheckItem.required ?? true}
                disabled={busy || readOnly}
                onChange={(event) => setCheckItemPatch(selectedCheckItem.id, { required: event.target.checked })}
              />
              必須チェック
            </label>
          </div>
        ) : (
          <div className="mt-3 rounded border border-dashed border-white/20 p-3 text-sm text-white/60">
            手順書上のチェックマーカーを選択
          </div>
        )}
      </>
    )}
  </section>
  ) : null;
}
