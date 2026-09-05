import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import {
  clearImageMarkerCalloutTip,
  imageMarkerHasCalloutTip
} from '../../kiosk/image-canvas';
import {
  AssemblyProcedureStepCropInspector,
  AssemblyProcedureStepInspector
} from '../AssemblyProcedureStepInspector';
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
    setStepSupplementOpen,
    stepSupplementOpen,
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
    <div className="mb-3 flex min-w-0 items-center justify-between gap-2 border-b border-white/10 pb-2">
      <h2 className="min-w-0 truncate text-sm font-bold">選択内容</h2>
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
    {markerSettingsOpen ? (
      markerMode === 'bolt' ? (
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
            <div className="flex min-w-0 items-baseline gap-2">
              <h2 className="text-sm font-bold">チェック項目</h2>
              {selectedCheckItem ? <div className="truncate text-[1.02rem] font-extrabold">チェック {selectedCheckItem.markerNo}</div> : null}
            </div>
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
            未選択
          </div>
        )}
      </>
      )
    ) : (
      <div className="rounded border border-dashed border-white/20 p-3 text-sm text-white/60">
        丸数字／丸チェックを選択してください
      </div>
    )}
    {selectedStep?.crop && selectedStepPage ? (
      <div className="mt-3">
        <AssemblyProcedureStepCropInspector
          step={selectedStep}
          page={selectedStepPage}
          readOnly={readOnly || busy}
          showFullPage={showFullPage}
          onShowFullPageChange={setShowFullPage}
          onPatch={(patch) => patchProcedureStep(selectedStep.localId, patch)}
        />
      </div>
    ) : null}
    <section className="mt-4 border-t border-white/10 pt-3">
      <button
        type="button"
        className="flex min-w-0 w-full items-start justify-between gap-2 text-left"
        aria-expanded={stepSupplementOpen}
        disabled={!selectedStep}
        onClick={() => setStepSupplementOpen(!stepSupplementOpen)}
      >
        <span className="min-w-0">
          <span className="block text-sm font-bold">この手順の注意・補足</span>
          <span className="mt-1 block min-w-0 truncate text-xs text-white/55">
            {selectedStep
              ? `${selectedStep.title.trim() || 'タイトル未入力'} · ${selectedStep.emphasis === 'caution' ? '注意' : selectedStep.emphasis === 'important' ? '重要' : '標準'}${selectedStep.instructionText.trim() ? ' · 指示文あり' : ''}`
              : '手順未選択'}
          </span>
        </span>
        <span className="shrink-0 text-sm text-white/60">{stepSupplementOpen ? '▲' : '▼'}</span>
      </button>
      {stepSupplementOpen && selectedStep ? (
        <div className="mt-3">
          <AssemblyProcedureStepInspector
            step={selectedStep}
            page={selectedStepPage}
            readOnly={readOnly || busy}
            showFullPage={showFullPage}
            onShowFullPageChange={setShowFullPage}
            onPatch={(patch) => patchProcedureStep(selectedStep.localId, patch)}
            includeCropControls={false}
          />
        </div>
      ) : null}
    </section>
  </section>
  ) : null;
}
