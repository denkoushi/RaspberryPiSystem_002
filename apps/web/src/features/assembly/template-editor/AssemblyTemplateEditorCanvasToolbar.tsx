import { Button } from '../../../components/ui/Button';
import { ImageCanvasZoomControls } from '../../kiosk/image-canvas';

import { useAssemblyTemplateEditor } from './AssemblyTemplateEditorContext';

export function AssemblyTemplateEditorCanvasToolbar() {
  const {
    addCurrentFullPageStep,
    canvasZoom,
    markerMode,
    pageOptions,
    placementAction,
    procedureSteps,
    readOnly,
    selectedBolt,
    selectedCheckItem,
    selectedDocument,
    selectedPage,
    selectedPageIndex,
    selectedPageKey,
    selectedStep,
    selectedStepPage,
    setInspectorMode,
    setMarkerMode,
    setPlacementAction,
    setSelectedBoltId,
    setSelectedCheckItemId,
    setSelectedPageKey,
    setShowFullPage
  } = useAssemblyTemplateEditor();
  return (
  <div
    data-testid="assembly-editor-toolbar"
    className="flex shrink-0 flex-wrap items-center gap-1 border-b border-white/10 px-2 py-2 xl:flex-nowrap xl:whitespace-nowrap"
  >
    <h2 className="shrink-0 text-[1.02rem] font-bold">手順書</h2>
    <select
      aria-label="ページ"
      className="min-h-9 min-w-36 flex-1 rounded border border-white/10 bg-slate-950 px-2 text-sm text-white xl:min-w-0"
      value={selectedPageKey}
      disabled={pageOptions.length === 0}
      onChange={(event) => setSelectedPageKey(event.target.value)}
    >
      {pageOptions.length === 0 ? <option value="">ページがありません</option> : null}
      {pageOptions.map((option) => (
        <option key={option.key} value={option.key}>
          {option.label}
        </option>
      ))}
    </select>
    <div className="flex shrink-0 gap-1" role="group" aria-label="ページ移動">
      <Button
        type="button"
        variant="ghostOnDark"
        className="min-h-10 !px-2 !py-1 text-xs"
        disabled={selectedPageIndex <= 0}
        onClick={() => setSelectedPageKey(pageOptions[selectedPageIndex - 1]!.key)}
      >
        前頁
      </Button>
      <Button
        type="button"
        variant="ghostOnDark"
        className="min-h-10 !px-2 !py-1 text-xs"
        disabled={
          selectedPageIndex < 0 || selectedPageIndex >= pageOptions.length - 1
        }
        onClick={() => setSelectedPageKey(pageOptions[selectedPageIndex + 1]!.key)}
      >
        次頁
      </Button>
    </div>
    <div className="flex shrink-0 gap-1" role="group" aria-label="表示ステップ操作">
      <Button
        type="button"
        variant="ghostOnDark"
        className="min-h-10 !px-2 !py-1 text-xs"
        disabled={readOnly || !selectedPage || procedureSteps.length >= 300}
        onClick={addCurrentFullPageStep}
      >
        全体追加
      </Button>
      <Button
        type="button"
        variant={placementAction === 'crop' ? 'primary' : 'ghostOnDark'}
        className="min-h-10 !px-2 !py-1 text-xs"
        disabled={readOnly || !selectedPage || procedureSteps.length >= 300}
        aria-pressed={placementAction === 'crop'}
        onClick={() => {
          setPlacementAction('crop');
          setShowFullPage(true);
        }}
      >
        矩形追加
      </Button>
      <Button
        type="button"
        variant="ghostOnDark"
        className="min-h-10 !px-2 !py-1 text-xs"
        disabled={readOnly || selectedStep?.viewMode !== 'crop'}
        onClick={() => {
          if (!selectedStep || !selectedStepPage) return;
          setSelectedPageKey(selectedStepPage.key);
          setShowFullPage(true);
          setInspectorMode('step');
        }}
      >
        範囲修正
      </Button>
    </div>
    <div className="flex shrink-0 gap-1" role="group" aria-label="マーカー種別">
      <Button
        type="button"
        aria-label="締結マーカー"
        aria-pressed={markerMode === 'bolt'}
        variant={markerMode === 'bolt' ? 'primary' : 'ghostOnDark'}
        className="min-h-9 !px-2 !py-1 text-xs"
        disabled={readOnly}
        onClick={() => {
          setMarkerMode('bolt');
          setSelectedCheckItemId(null);
        }}
      >
        締結
      </Button>
      <Button
        type="button"
        aria-label="チェックマーカー"
        aria-pressed={markerMode === 'check'}
        variant={markerMode === 'check' ? 'primary' : 'ghostOnDark'}
        className="min-h-9 !px-2 !py-1 text-xs"
        disabled={readOnly}
        onClick={() => {
          setMarkerMode('check');
          setSelectedBoltId(null);
        }}
      >
        チェック
      </Button>
    </div>
    <div className="flex shrink-0 gap-1" role="group" aria-label="マーカー操作">
      <Button
        type="button"
        variant={placementAction === 'place' ? 'primary' : 'ghostOnDark'}
        className="min-h-9 !px-2 !py-1 text-xs"
        disabled={readOnly}
        aria-pressed={placementAction === 'place'}
        onClick={() => setPlacementAction('place')}
      >
        丸数字
      </Button>
      <Button
        type="button"
        variant={placementAction === 'callout' ? 'primary' : 'ghostOnDark'}
        className="min-h-9 !px-2 !py-1 text-xs"
        disabled={readOnly || (markerMode === 'bolt' ? !selectedBolt : !selectedCheckItem)}
        aria-pressed={placementAction === 'callout'}
        onClick={() => setPlacementAction('callout')}
      >
        矢視
      </Button>
    </div>
    <ImageCanvasZoomControls
      enabled={Boolean(selectedPage?.imageRelativePath ?? selectedDocument?.imageRelativePath)}
      onZoomIn={canvasZoom.zoomIn}
      onZoomOut={canvasZoom.zoomOut}
      onFitToView={canvasZoom.fitToView}
      controlsClassName="shrink-0 rounded bg-slate-950/70 p-1"
    />
  </div>
  );
}
