import { useState } from 'react';

import {
  AssemblyProcedureCanvas,
  AssemblyProcedureImageWithMarkers,
  createAssemblyBoltAt,
  draftToCanvasBolts,
  emptyAssemblyArea
} from '../../features/assembly';
import {
  ImageCanvasZoomControls,
  ImageMarkerPositionNudge,
  useImageCanvasZoom
} from '../../features/kiosk/image-canvas';

import type { AssemblyCanvasCheckItem } from '../../features/assembly';

const PREVIEW_PROCEDURE_IMAGE = `data:image/svg+xml,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="900" height="620" viewBox="0 0 900 620">
  <rect width="900" height="620" fill="#f8fafc"/>
  <rect x="78" y="96" width="744" height="396" rx="18" fill="#dbeafe" stroke="#334155" stroke-width="4"/>
  <rect x="210" y="190" width="480" height="210" rx="14" fill="#e2e8f0" stroke="#475569" stroke-width="3"/>
  <line x1="250" y1="240" x2="650" y2="240" stroke="#64748b" stroke-width="3"/>
  <line x1="250" y1="350" x2="650" y2="350" stroke="#64748b" stroke-width="3"/>
  <circle cx="288" cy="260" r="28" fill="#94a3b8"/>
  <circle cx="522" cy="278" r="28" fill="#94a3b8"/>
  <circle cx="612" cy="362" r="28" fill="#94a3b8"/>
  <text x="450" y="555" text-anchor="middle" font-family="Arial" font-size="34" fill="#0f172a">ASSEMBLY PROCEDURE</text>
</svg>
`)}`;

export function KioskAssemblyTemplateEditorPreviewPage() {
  const canvasZoom = useImageCanvasZoom();
  const [area, setArea] = useState(() => {
    const draft = emptyAssemblyArea();
    draft.bolts = [
      {
        id: 'bolt-1',
        sortOrder: 0,
        tighteningId: 'P7-A13-U1-B1',
        markerNo: 1,
        xRatio: 0.32,
        yRatio: 0.42,
        calloutTipXRatio: 0.2,
        calloutTipYRatio: 0.2,
        boltSpec: 'M6x30',
        nominalTorque: 90,
        lowerLimit: 81,
        upperLimit: 99,
        unit: 'kgf-cm'
      },
      {
        id: 'bolt-2',
        sortOrder: 1,
        tighteningId: 'P7-A13-U1-B2',
        markerNo: 2,
        xRatio: 0.58,
        yRatio: 0.45,
        boltSpec: 'M6x30',
        nominalTorque: 90,
        lowerLimit: 81,
        upperLimit: 99,
        unit: 'kgf-cm'
      }
    ];
    return draft;
  });
  const [checkItems, setCheckItems] = useState<AssemblyCanvasCheckItem[]>([
    {
      id: 'check-1',
      markerNo: 1,
      xRatio: 0.68,
      yRatio: 0.6,
      calloutTipXRatio: 0.82,
      calloutTipYRatio: 0.78,
      label: '目視確認',
      required: true,
      checked: false
    }
  ]);
  const [selectedBoltId, setSelectedBoltId] = useState<string | null>('bolt-1');
  const [selectedCheckItemId, setSelectedCheckItemId] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<'editor' | 'work'>('editor');
  const [markerMode, setMarkerMode] = useState<'bolt' | 'check'>('bolt');
  const [placementAction, setPlacementAction] = useState<'place' | 'callout'>('place');
  const selectedBolt = area.bolts.find((bolt) => bolt.id === selectedBoltId) ?? null;
  const selectedCheckItem = checkItems.find((item) => item.id === selectedCheckItemId) ?? null;

  const deleteSelectedBolt = () => {
    if (!selectedBolt) return;
    setArea((current) => ({
      ...current,
      bolts: current.bolts.filter((bolt) => bolt.id !== selectedBolt.id)
    }));
    setSelectedBoltId(null);
  };

  const deleteSelectedCheckItem = () => {
    if (!selectedCheckItem) return;
    setCheckItems((current) => current.filter((item) => item.id !== selectedCheckItem.id));
    setSelectedCheckItemId(null);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 bg-slate-800 p-2 text-white">
      <div className="flex items-center justify-between gap-2 rounded border border-white/15 bg-slate-900/70 p-2">
        <h1 className="text-[1.28rem] font-bold leading-tight">
          {previewMode === 'editor' ? '組立テンプレート編集' : '組立作業表示'}
        </h1>
        <button
          type="button"
          className="rounded border border-white/20 bg-slate-950 px-3 py-1 text-xs font-bold text-white hover:border-cyan-300"
          onClick={() => setPreviewMode((current) => current === 'editor' ? 'work' : 'editor')}
        >
          {previewMode === 'editor' ? '作業画面表示' : '編集画面表示'}
        </button>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-auto xl:grid-cols-[minmax(14rem,18rem)_minmax(0,1fr)_minmax(18rem,22rem)] xl:overflow-hidden">
        <section className="rounded border border-white/15 bg-slate-900/70 p-3">
          <h2 className="text-[1.02rem] font-bold">基本</h2>
          <div className="mt-3 grid gap-2 text-sm text-white/80">
            <div>型番/FHINCD: FH-20A</div>
            <div>手順パターン: 手順7</div>
            <div>工程: {area.processNo}-{area.areaCode}</div>
          </div>
        </section>
        <section className="flex min-h-[32rem] flex-col overflow-hidden rounded border border-white/15 bg-slate-900/70 xl:min-h-0">
          <div
            data-testid="assembly-editor-toolbar"
            className="flex shrink-0 flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2 xl:flex-nowrap xl:whitespace-nowrap"
          >
            <h2 className="shrink-0 text-[1.02rem] font-bold">手順書</h2>
            <select className="min-h-9 min-w-36 flex-1 rounded border border-white/10 bg-slate-950 px-2 text-sm text-white xl:min-w-0" aria-label="ページ">
              <option>1 / 3 組立手順書</option>
            </select>
            <div className="flex shrink-0 gap-1" role="group" aria-label="マーカー種別">
              <button
                type="button"
                aria-label="締結マーカー"
                aria-pressed={markerMode === 'bolt'}
                className={markerMode === 'bolt' ? 'rounded bg-cyan-600 px-2 py-1 text-xs font-bold text-white' : 'rounded border border-white/20 px-2 py-1 text-xs font-bold'}
                onClick={() => {
                  setMarkerMode('bolt');
                  setSelectedCheckItemId(null);
                }}
              >
                締結
              </button>
              <button
                type="button"
                aria-label="チェックマーカー"
                aria-pressed={markerMode === 'check'}
                className={markerMode === 'check' ? 'rounded bg-cyan-600 px-2 py-1 text-xs font-bold text-white' : 'rounded border border-white/20 px-2 py-1 text-xs font-bold'}
                onClick={() => {
                  setMarkerMode('check');
                  setSelectedBoltId(null);
                }}
              >
                チェック
              </button>
            </div>
            <div className="flex shrink-0 gap-1" role="group" aria-label="マーカー操作">
              <button
                type="button"
                aria-pressed={placementAction === 'place'}
                className={placementAction === 'place' ? 'rounded bg-cyan-600 px-2 py-1 text-xs font-bold text-white' : 'rounded border border-white/20 px-2 py-1 text-xs font-bold'}
                onClick={() => setPlacementAction('place')}
              >
                丸数字
              </button>
              <button
                type="button"
                aria-pressed={placementAction === 'callout'}
                className={placementAction === 'callout' ? 'rounded bg-cyan-600 px-2 py-1 text-xs font-bold text-white' : 'rounded border border-white/20 px-2 py-1 text-xs font-bold'}
                onClick={() => setPlacementAction('callout')}
              >
                矢視
              </button>
            </div>
            <ImageCanvasZoomControls
              enabled
              onZoomIn={canvasZoom.zoomIn}
              onZoomOut={canvasZoom.zoomOut}
              onFitToView={canvasZoom.fitToView}
              controlsClassName="shrink-0 rounded bg-slate-950/70 p-1"
            />
          </div>
          <div className="min-h-0 flex-1">
            {previewMode === 'editor' ? (
              <AssemblyProcedureCanvas
                imageRelativePath={PREVIEW_PROCEDURE_IMAGE}
                bolts={draftToCanvasBolts([area])}
                checkItems={checkItems}
                selectedBoltId={selectedBoltId}
                selectedCheckItemId={selectedCheckItemId}
                onSelectBolt={(id) => {
                  setMarkerMode('bolt');
                  setSelectedBoltId(id);
                  setSelectedCheckItemId(null);
                }}
                onSelectCheckItem={(id) => {
                  setMarkerMode('check');
                  setSelectedCheckItemId(id);
                  setSelectedBoltId(null);
                }}
                onAddBolt={markerMode === 'bolt' && placementAction === 'place' ? (xRatio, yRatio) => {
                  setArea((current) => ({
                    ...current,
                    bolts: [...current.bolts, createAssemblyBoltAt(current, xRatio, yRatio)]
                  }));
                } : undefined}
                zoom={canvasZoom.zoom}
                fitGeneration={canvasZoom.fitGeneration}
                className="h-full"
              />
            ) : (
              <AssemblyProcedureImageWithMarkers
                fitToParent
                imageContent={<img src={PREVIEW_PROCEDURE_IMAGE} alt="組立手順書" />}
                bolts={draftToCanvasBolts([area])}
                checkItems={checkItems}
                selectedBoltId={selectedBoltId}
                className="h-full w-full"
              />
            )}
          </div>
        </section>
        <section
          data-testid="assembly-editor-settings-pane"
          className="min-h-0 min-w-0 overflow-x-hidden overflow-y-auto rounded border border-white/15 bg-slate-900/70 p-3"
        >
          {previewMode === 'work' ? (
            <>
              <h2 className="text-[1.02rem] font-bold">締付条件</h2>
              <div className="mt-3 rounded border border-white/10 bg-slate-950 p-3 text-sm text-white/70">
                保存済みマーカーと矢視を表示（位置調整はテンプレート編集で行います）
              </div>
            </>
          ) : markerMode === 'bolt' ? (
            <>
              <div className="flex min-w-0 items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="text-[1.02rem] font-bold">締付条件</h2>
                  {selectedBolt ? (
                    <>
                      <div className="mt-0.5 truncate text-sm font-bold">丸数字 {selectedBolt.markerNo}</div>
                      <div className="mt-0.5 truncate text-[0.68rem] text-white/55">ページ: assembly-procedure-document / preview / 1</div>
                    </>
                  ) : null}
                </div>
                {selectedBolt ? (
                  <button type="button" className="shrink-0 rounded border border-red-300/70 px-2 py-1 text-xs font-bold text-red-200" onClick={deleteSelectedBolt}>削除</button>
                ) : null}
              </div>
              {selectedBolt ? (
                <div className="mt-2 grid min-w-0 gap-2 text-sm text-white/80">
                  <div className="flex min-h-8 min-w-0 items-center gap-1 rounded border border-white/10 bg-slate-950/60 px-1.5 py-1">
                    <span className="shrink-0 text-[0.68rem] font-semibold">矢視 あり</span>
                    <button type="button" className="min-h-7 shrink-0 rounded border border-white/20 px-1.5 py-0.5 text-[0.68rem] font-bold">矢視削除</button>
                    <ImageMarkerPositionNudge
                      position={selectedBolt}
                      groupLabel="締結マーカーの位置調整"
                      className="min-w-0 flex-1 [&>button]:min-w-0 [&>button]:flex-1 [&>button]:px-1"
                      onChange={(patch) => {
                        setArea((current) => ({
                          ...current,
                          bolts: current.bolts.map((bolt) => bolt.id === selectedBolt.id ? { ...bolt, ...patch } : bolt)
                        }));
                      }}
                    />
                  </div>
                  <label className="flex min-h-8 min-w-0 items-center gap-2 rounded border border-white/10 bg-slate-950/60 px-2 py-1 text-[0.7rem] font-semibold">
                    <input type="checkbox" defaultChecked />次の丸数字へこの条件を引き継ぐ
                  </label>
                  <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-1 rounded border border-cyan-300/20 bg-cyan-950/20 p-1.5">
                    <label className="grid min-w-0 gap-0.5 text-[0.65rem] font-semibold">反映開始<input className="h-8 min-w-0 rounded border border-white/15 bg-slate-950 px-2 py-1 text-sm" defaultValue="1" /></label>
                    <label className="grid min-w-0 gap-0.5 text-[0.65rem] font-semibold">反映終了<input className="h-8 min-w-0 rounded border border-white/15 bg-slate-950 px-2 py-1 text-sm" defaultValue="35" /></label>
                    <button type="button" className="min-h-8 whitespace-nowrap rounded border border-white/20 px-2 py-1 text-[0.68rem] font-bold">条件反映</button>
                  </div>
                  <div data-testid="assembly-editor-bolt-fields" className="grid min-w-0 gap-1.5">
                    <div className="grid min-w-0 grid-cols-[minmax(0,0.75fr)_minmax(0,0.75fr)_minmax(0,1.5fr)] gap-1.5">
                      <label className="grid min-w-0 gap-0.5 text-[0.68rem] font-semibold">呼び径<input className="h-8 min-w-0 rounded border border-white/15 bg-slate-950 px-2 py-1 text-sm" defaultValue="M6" /></label>
                      <label className="grid min-w-0 gap-0.5 text-[0.68rem] font-semibold">長さ (mm)<input className="h-8 min-w-0 rounded border border-white/15 bg-slate-950 px-2 py-1 text-sm" defaultValue="30" /></label>
                      <label className="grid min-w-0 gap-0.5 text-[0.68rem] font-semibold">材質<input className="h-8 min-w-0 rounded border border-white/15 bg-slate-950 px-2 py-1 text-sm" defaultValue="SCM435" /></label>
                    </div>
                    <div className="grid min-w-0 grid-cols-2 gap-1.5">
                      <label className="grid min-w-0 gap-0.5 text-[0.68rem] font-semibold">強度区分<input className="h-8 min-w-0 rounded border border-white/15 bg-slate-950 px-2 py-1 text-sm" defaultValue="10.9" /></label>
                      <label className="grid min-w-0 gap-0.5 text-[0.68rem] font-semibold">表示用ボルト仕様<input className="h-8 min-w-0 rounded border border-white/15 bg-slate-950 px-2 py-1 text-sm" defaultValue={selectedBolt.boltSpec} /></label>
                    </div>
                    <div className="grid min-w-0 grid-cols-4 gap-1.5">
                      <label className="grid min-w-0 gap-0.5 text-[0.68rem] font-semibold">下限<input className="h-8 min-w-0 rounded border border-white/15 bg-slate-950 px-2 py-1 text-sm" defaultValue="81" /></label>
                      <label className="grid min-w-0 gap-0.5 text-[0.68rem] font-semibold">規定<input className="h-8 min-w-0 rounded border border-white/15 bg-slate-950 px-2 py-1 text-sm" defaultValue="90" /></label>
                      <label className="grid min-w-0 gap-0.5 text-[0.68rem] font-semibold">上限<input className="h-8 min-w-0 rounded border border-white/15 bg-slate-950 px-2 py-1 text-sm" defaultValue="99" /></label>
                      <label className="grid min-w-0 gap-0.5 text-[0.68rem] font-semibold">単位<select className="h-8 min-w-0 w-full rounded border border-white/15 bg-slate-950 px-1.5 text-xs" defaultValue="kgf-cm"><option value="N-m">N·m</option><option value="kgf-cm">kgf·cm</option></select></label>
                    </div>
                    <label className="grid min-w-0 gap-0.5 text-[0.68rem] font-semibold">適合トルクレンチグループ<select className="h-8 min-w-0 w-full rounded border border-white/15 bg-slate-950 px-2 text-sm"><option>TC-100 長いグループ名称（3 型番）</option></select></label>
                  </div>
                </div>
              ) : (
                <div className="mt-3 rounded border border-dashed border-white/20 p-3 text-sm text-white/60">手順書上の締結マーカーを選択</div>
              )}
            </>
          ) : (
            <>
              <div className="flex min-w-0 items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="text-[1.02rem] font-bold">チェック項目</h2>
                  {selectedCheckItem ? <div className="mt-1 truncate text-sm font-bold">チェック {selectedCheckItem.markerNo}</div> : null}
                </div>
                {selectedCheckItem ? (
                  <button type="button" className="shrink-0 rounded border border-red-300/70 px-2 py-1 text-xs font-bold text-red-200" onClick={deleteSelectedCheckItem}>削除</button>
                ) : null}
              </div>
              {selectedCheckItem ? (
                <div className="mt-3 grid min-w-0 gap-3 text-sm text-white/80">
                  <div className="flex min-h-9 min-w-0 items-center justify-between gap-2 rounded border border-white/10 bg-slate-950/60 px-2">
                    <span className="text-xs font-semibold">矢視 あり</span>
                    <button type="button" className="shrink-0 rounded border border-white/20 px-2 py-1 text-xs font-bold">矢視削除</button>
                  </div>
                  <ImageMarkerPositionNudge
                    position={selectedCheckItem}
                    groupLabel="チェックマーカーの位置調整"
                    className="min-w-0 [&>button]:min-w-0 [&>button]:flex-1"
                    onChange={(patch) => {
                      setCheckItems((current) => current.map((item) => item.id === selectedCheckItem.id ? { ...item, ...patch } : item));
                    }}
                  />
                  <label className="grid min-w-0 gap-1 text-xs font-semibold">ラベル<input className="min-w-0 rounded border border-white/15 bg-slate-950 px-2 py-2 text-sm" defaultValue={selectedCheckItem.label ?? ''} /></label>
                  <label className="flex min-w-0 items-center gap-2 text-xs font-semibold"><input type="checkbox" defaultChecked={selectedCheckItem.required ?? true} />必須チェック</label>
                </div>
              ) : (
                <div className="mt-3 rounded border border-dashed border-white/20 p-3 text-sm text-white/60">手順書上のチェックマーカーを選択</div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
