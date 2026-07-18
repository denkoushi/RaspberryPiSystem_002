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
  const selectedBolt = area.bolts.find((bolt) => bolt.id === selectedBoltId) ?? null;
  const selectedCheckItem = checkItems.find((item) => item.id === selectedCheckItemId) ?? null;

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
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-auto xl:grid-cols-[22rem_minmax(0,1fr)_24rem] xl:overflow-hidden">
        <section className="rounded border border-white/15 bg-slate-900/70 p-3">
          <h2 className="text-[1.02rem] font-bold">基本</h2>
          <div className="mt-3 grid gap-2 text-sm text-white/80">
            <div>型番/FHINCD: FH-20A</div>
            <div>手順パターン: 手順7</div>
            <div>工程: {area.processNo}-{area.areaCode}</div>
          </div>
        </section>
        <section className="flex min-h-[32rem] flex-col overflow-hidden rounded border border-white/15 bg-slate-900/70 xl:min-h-0">
          <div className="shrink-0 border-b border-white/10 p-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-[1.02rem] font-bold">手順書 / マーカー</h2>
              <ImageCanvasZoomControls
                enabled
                onZoomIn={canvasZoom.zoomIn}
                onZoomOut={canvasZoom.zoomOut}
                onFitToView={canvasZoom.fitToView}
                controlsClassName="rounded bg-slate-950/70 p-1"
              />
            </div>
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
                  setSelectedBoltId(id);
                  setSelectedCheckItemId(null);
                }}
                onSelectCheckItem={(id) => {
                  setSelectedCheckItemId(id);
                  setSelectedBoltId(null);
                }}
                onAddBolt={(xRatio, yRatio) => {
                  setArea((current) => ({
                    ...current,
                    bolts: [...current.bolts, createAssemblyBoltAt(current, xRatio, yRatio)]
                  }));
                }}
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
        <section className="rounded border border-white/15 bg-slate-900/70 p-3">
          <h2 className="text-[1.02rem] font-bold">
            {selectedCheckItem ? 'チェック項目' : '締付条件'}
          </h2>
          {previewMode === 'work' ? (
            <div className="mt-3 rounded border border-white/10 bg-slate-950 p-3 text-sm text-white/70">
              保存済みマーカーと矢視を表示（位置調整はテンプレート編集で行います）
            </div>
          ) : selectedBolt ? (
            <div className="mt-3 grid gap-3 rounded border border-white/10 bg-slate-950 p-3 text-sm text-white/80">
              <div>{selectedBolt.tighteningId} / {selectedBolt.nominalTorque} {selectedBolt.unit}</div>
              <ImageMarkerPositionNudge
                position={selectedBolt}
                groupLabel="締結マーカーの位置調整"
                onChange={(patch) => {
                  setArea((current) => ({
                    ...current,
                    bolts: current.bolts.map((bolt) =>
                      bolt.id === selectedBolt.id ? { ...bolt, ...patch } : bolt
                    )
                  }));
                }}
              />
            </div>
          ) : selectedCheckItem ? (
            <div className="mt-3 grid gap-3 rounded border border-white/10 bg-slate-950 p-3 text-sm text-white/80">
              <div>{selectedCheckItem.label}</div>
              <ImageMarkerPositionNudge
                position={selectedCheckItem}
                groupLabel="チェックマーカーの位置調整"
                onChange={(patch) => {
                  setCheckItems((current) => current.map((item) =>
                    item.id === selectedCheckItem.id ? { ...item, ...patch } : item
                  ));
                }}
              />
            </div>
          ) : (
            <div className="mt-3 rounded border border-dashed border-white/20 p-3 text-sm text-white/60">
              手順書上のマーカーを選択
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
