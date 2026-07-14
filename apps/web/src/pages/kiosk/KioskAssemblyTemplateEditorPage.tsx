import clsx from 'clsx';
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';

import {
  createAssemblyTemplate,
  getAssemblyProcedureOrder,
  getAssemblyTemplate,
  getKioskDocumentDetail,
  listAssemblyProcedureDocumentSummaries,
  reviseAssemblyTemplate
} from '../../api/client';
import { Button, buttonClassName } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import {
  AssemblyProcedureCanvas,
  buildAssemblyEditorPageOptions,
  createAssemblyBoltAt,
  createAssemblyCheckItemAt,
  draftAreasToInput,
  draftCheckItemsToInput,
  emptyAssemblyArea,
  filterDraftBoltsForPage,
  filterDraftCheckItemsForPage,
  kioskAssemblyTemplateEditPath,
  kioskAssemblyTemplateNewPath,
  KIOSK_ASSEMBLY_LIBRARY_PATH,
  pageRefKey,
  parseAssemblyTemplateNewSearch,
  readAssemblyApiErrorMessage,
  renumberDraftCheckItems,
  resolveAssemblyDocumentStatus,
  templateToDraftAreas,
  templateToDraftCheckItems
} from '../../features/assembly';
import {
  clearImageMarkerCalloutTip,
  ImageCanvasZoomControls,
  imageMarkerHasCalloutTip,
  setImageMarkerCalloutTip,
  useImageCanvasZoom
} from '../../features/kiosk/image-canvas';

import type { AssemblyDraftArea, AssemblyDraftBolt, AssemblyDraftCheckItem, AssemblyEditorPageOption } from '../../features/assembly';
import type { AssemblyProcedureDocumentSummaryDto, AssemblyTemplateDto } from '../../features/assembly/types';

function selectFirstAreaId(areas: AssemblyDraftArea[]): string {
  return areas[0]?.id ?? '';
}

export function KioskAssemblyTemplateEditorPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { templateId } = useParams<{ templateId?: string }>();
  const query = useMemo(() => parseAssemblyTemplateNewSearch(location.search), [location.search]);
  const [documents, setDocuments] = useState<AssemblyProcedureDocumentSummaryDto[]>([]);
  const [loadedTemplate, setLoadedTemplate] = useState<AssemblyTemplateDto | null>(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState(query.procedureDocumentId ?? '');
  const [templateName, setTemplateName] = useState('組立トルクテンプレート');
  const [modelCode, setModelCode] = useState('');
  const [procedurePattern, setProcedurePattern] = useState('手順7');
  const [areas, setAreas] = useState<AssemblyDraftArea[]>(() => [emptyAssemblyArea()]);
  const [checkItems, setCheckItems] = useState<AssemblyDraftCheckItem[]>([]);
  const [selectedAreaId, setSelectedAreaId] = useState('');
  const [selectedBoltId, setSelectedBoltId] = useState<string | null>(null);
  const [selectedCheckItemId, setSelectedCheckItemId] = useState<string | null>(null);
  const [markerMode, setMarkerMode] = useState<'bolt' | 'check'>('bolt');
  const [placementAction, setPlacementAction] = useState<'place' | 'callout'>('place');
  const [pageOptions, setPageOptions] = useState<AssemblyEditorPageOption[]>([]);
  const [selectedPageKey, setSelectedPageKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const canvasZoom = useImageCanvasZoom();
  const fitCanvasToView = canvasZoom.fitToView;

  const readOnly = Boolean(templateId && loadedTemplate && !loadedTemplate.isActive);
  const selectedDocument = useMemo(
    () => documents.find((document) => document.id === selectedDocumentId) ?? loadedTemplate?.procedureDocument ?? null,
    [documents, loadedTemplate?.procedureDocument, selectedDocumentId]
  );
  const selectedArea = areas.find((area) => area.id === selectedAreaId) ?? areas[0] ?? null;
  const selectedBolt = selectedArea?.bolts.find((bolt) => bolt.id === selectedBoltId) ?? null;
  const selectedCheckItem = checkItems.find((item) => item.id === selectedCheckItemId) ?? null;
  const selectedPage = pageOptions.find((option) => option.key === selectedPageKey) ?? pageOptions[0] ?? null;

  useEffect(() => {
    fitCanvasToView();
    setSelectedBoltId(null);
    setSelectedCheckItemId(null);
  }, [fitCanvasToView, selectedPageKey]);

  useEffect(() => {
    if (areas.length > 0 && !areas.some((area) => area.id === selectedAreaId)) {
      setSelectedAreaId(areas[0].id);
      setSelectedBoltId(null);
    }
  }, [areas, selectedAreaId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMessage(null);
    void Promise.all([
      listAssemblyProcedureDocumentSummaries({ includeInactive: true, limit: 200 }),
      templateId || query.sourceTemplateId ? getAssemblyTemplate(templateId ?? query.sourceTemplateId!) : Promise.resolve(null)
    ])
      .then(([nextDocuments, template]) => {
        if (cancelled) return;
        setDocuments(nextDocuments);
        if (template) {
          setLoadedTemplate(template);
          const nextAreas = templateToDraftAreas(template);
          const nextCheckItems = templateToDraftCheckItems(template);
          setAreas(nextAreas.length > 0 ? nextAreas : [emptyAssemblyArea()]);
          setCheckItems(nextCheckItems);
          setSelectedAreaId(selectFirstAreaId(nextAreas));
          setSelectedBoltId(null);
          setSelectedCheckItemId(null);
          setSelectedDocumentId(template.procedureDocumentId);
          if (templateId) {
            setTemplateName(template.name);
            setModelCode(template.modelCode);
            setProcedurePattern(template.procedurePattern);
          } else {
            setTemplateName(`${template.name} 雛形`);
            setModelCode('');
            setProcedurePattern(template.procedurePattern);
          }
        } else {
          setLoadedTemplate(null);
          setSelectedDocumentId((current) => current || query.procedureDocumentId || nextDocuments.find((doc) => doc.isActive)?.id || '');
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setMessage(readAssemblyApiErrorMessage(e, 'テンプレート編集データの取得に失敗しました。'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [query.procedureDocumentId, query.sourceTemplateId, templateId]);

  useEffect(() => {
    let cancelled = false;

    const buildOptions = async () => {
      const orderAssemblyDocuments: AssemblyProcedureDocumentSummaryDto[] = [];
      const kioskPages: Array<{ documentId: string; title: string; pageUrls: string[] }> = [];

      if (modelCode.trim()) {
        try {
          const order = await getAssemblyProcedureOrder(modelCode.trim());
          for (const item of order.items) {
            if (item.documentType === 'assembly_procedure_document' && item.assemblyProcedureDocumentId) {
              const doc = documents.find((candidate) => candidate.id === item.assemblyProcedureDocumentId);
              if (doc) orderAssemblyDocuments.push(doc);
            }
            if (item.documentType === 'kiosk_document' && item.kioskDocumentId && item.document.enabled) {
              try {
                const detail = await getKioskDocumentDetail(item.kioskDocumentId);
                kioskPages.push({
                  documentId: item.kioskDocumentId,
                  title: item.document.displayTitle?.trim() || item.document.title,
                  pageUrls: detail.pageUrls ?? []
                });
              } catch {
                // ignore missing kiosk preview pages
              }
            }
          }
        } catch {
          // order not configured
        }
      }

      if (cancelled) return;
      const nextOptions = buildAssemblyEditorPageOptions({
        primaryDocument: selectedDocument,
        orderAssemblyDocuments,
        kioskPages
      });
      setPageOptions(nextOptions);
      setSelectedPageKey((current) => (nextOptions.some((option) => option.key === current) ? current : nextOptions[0]?.key ?? ''));
    };

    void buildOptions();
    return () => {
      cancelled = true;
    };
  }, [documents, modelCode, selectedDocument]);

  const currentPageRef = useMemo(() => {
    if (!selectedPage) return null;
    return {
      source: selectedPage.source,
      documentId: selectedPage.documentId,
      pageIndex: selectedPage.pageIndex
    } as const;
  }, [selectedPage]);

  const visibleBolts = useMemo(() => {
    if (!currentPageRef || !selectedDocumentId) return [];
    return filterDraftBoltsForPage(areas, currentPageRef, selectedDocumentId);
  }, [areas, currentPageRef, selectedDocumentId]);

  const visibleCheckItems = useMemo(() => {
    if (!currentPageRef || !selectedDocumentId) return [];
    return filterDraftCheckItemsForPage(checkItems, currentPageRef, selectedDocumentId);
  }, [checkItems, currentPageRef, selectedDocumentId]);

  const setAreaPatch = (areaId: string, patch: Partial<AssemblyDraftArea>) => {
    setAreas((prev) => prev.map((area) => (area.id === areaId ? { ...area, ...patch } : area)));
  };

  const setBoltPatch = (boltId: string, patch: Partial<AssemblyDraftBolt>) => {
    setAreas((prev) =>
      prev.map((area) => ({
        ...area,
        bolts: area.bolts.map((bolt) => (bolt.id === boltId ? { ...bolt, ...patch } : bolt))
      }))
    );
  };

  const setCheckItemPatch = (checkItemId: string, patch: Partial<AssemblyDraftCheckItem>) => {
    setCheckItems((prev) => prev.map((item) => (item.id === checkItemId ? { ...item, ...patch } : item)));
  };

  const addArea = () => {
    const next = emptyAssemblyArea(areas.length);
    setAreas((prev) => [...prev, next]);
    setSelectedAreaId(next.id);
    setSelectedBoltId(null);
    setSelectedCheckItemId(null);
  };

  const deleteSelectedBolt = () => {
    if (!selectedBolt || !selectedArea) return;
    setAreas((prev) =>
      prev.map((area) => {
        if (area.id !== selectedArea.id) return area;
        const bolts = area.bolts
          .filter((bolt) => bolt.id !== selectedBolt.id)
          .map((bolt, index) => ({ ...bolt, sortOrder: index, markerNo: index + 1 }));
        return { ...area, bolts };
      })
    );
    setSelectedBoltId(null);
  };

  const deleteSelectedCheckItem = () => {
    if (!selectedCheckItem) return;
    setCheckItems((prev) => renumberDraftCheckItems(prev.filter((item) => item.id !== selectedCheckItem.id)));
    setSelectedCheckItemId(null);
  };

  const addBoltAt = (xRatio: number, yRatio: number) => {
    if (readOnly || !selectedArea || !currentPageRef) return;
    const next = createAssemblyBoltAt(selectedArea, xRatio, yRatio, currentPageRef);
    setAreas((prev) => prev.map((area) => (area.id === selectedArea.id ? { ...area, bolts: [...area.bolts, next] } : area)));
    setSelectedBoltId(next.id);
    setSelectedCheckItemId(null);
  };

  const addCheckItemAt = (xRatio: number, yRatio: number) => {
    if (readOnly || !currentPageRef) return;
    const next = createAssemblyCheckItemAt(checkItems, xRatio, yRatio, currentPageRef);
    setCheckItems((prev) => renumberDraftCheckItems([...prev, next]));
    setSelectedCheckItemId(next.id);
    setSelectedBoltId(null);
  };

  const placeSelectedCalloutAt = (xRatio: number, yRatio: number) => {
    if (readOnly) return;
    const calloutTip = setImageMarkerCalloutTip(xRatio, yRatio);
    if (markerMode === 'bolt' && selectedBolt) {
      setBoltPatch(selectedBolt.id, calloutTip);
    }
    if (markerMode === 'check' && selectedCheckItem) {
      setCheckItemPatch(selectedCheckItem.id, calloutTip);
    }
  };

  const saveTemplate = async () => {
    if (readOnly) return;
    setBusy(true);
    setMessage(null);
    try {
      if (!selectedDocumentId) throw new Error('手順書を選択してください。');
      if (selectedDocument && !selectedDocument.isActive) throw new Error('有効な手順書を選択してください。');
      if (selectedDocument && resolveAssemblyDocumentStatus(selectedDocument) !== 'published') {
        throw new Error('手順書を公開してから保存してください。');
      }
      const payload = {
        name: templateName,
        modelCode,
        procedurePattern,
        procedureDocumentId: selectedDocumentId,
        areas: draftAreasToInput(areas),
        checkItems: draftCheckItemsToInput(checkItems)
      };
      const saved = templateId ? await reviseAssemblyTemplate(templateId, payload) : await createAssemblyTemplate(payload);
      navigate(kioskAssemblyTemplateEditPath(saved.id), { replace: true });
    } catch (e: unknown) {
      setMessage(e instanceof Error ? e.message : readAssemblyApiErrorMessage(e, 'テンプレートの保存に失敗しました。'));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-slate-800 text-white">
        読込中…
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 bg-slate-800 p-2 text-white">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-white/15 bg-slate-900/70 p-2">
        <div className="min-w-0">
          <h1 className="text-[1.28rem] font-bold leading-tight">
            {templateId ? '組立テンプレート編集' : '組立テンプレート新規'}
          </h1>
          {readOnly ? <p className="mt-1 text-[0.86rem] font-semibold text-amber-200">旧版は表示のみです。</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to={KIOSK_ASSEMBLY_LIBRARY_PATH}
            className={buttonClassName('ghostOnDark', 'inline-flex min-h-10 items-center text-[0.95rem]')}
          >
            一覧へ
          </Link>
          {loadedTemplate ? (
            <Link
              to={kioskAssemblyTemplateNewPath({ sourceTemplateId: loadedTemplate.id })}
              className={buttonClassName('ghostOnDark', 'inline-flex min-h-10 items-center text-[0.95rem]')}
            >
              雛形
            </Link>
          ) : null}
          <Button type="button" variant="primary" className="min-h-10 text-[0.95rem]" disabled={busy || readOnly} onClick={() => void saveTemplate()}>
            {busy ? '保存中…' : templateId ? '新しい版で保存' : '保存'}
          </Button>
        </div>
      </div>

      {message ? <p className="rounded border border-white/15 bg-slate-900/80 px-3 py-2 text-sm font-semibold text-amber-200">{message}</p> : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-auto xl:grid-cols-[minmax(18rem,24rem)_minmax(0,1fr)_minmax(20rem,25rem)] xl:overflow-hidden">
        <section className="min-h-0 overflow-y-auto rounded border border-white/15 bg-slate-900/70 p-3">
          <h2 className="text-[1.02rem] font-bold">基本</h2>
          <div className="mt-3 grid gap-3">
            <label className="grid gap-1 text-xs font-semibold text-white/70">
              手順書
              <select
                className="min-h-10 rounded border border-white/10 bg-slate-950 px-2 text-sm text-white"
                value={selectedDocumentId}
                disabled={busy || readOnly}
                onChange={(event) => setSelectedDocumentId(event.target.value)}
              >
                <option value="">未選択</option>
                {documents.map((document) => (
                  <option key={document.id} value={document.id}>
                    {document.name}
                    {resolveAssemblyDocumentStatus(document) === 'draft' ? '（下書き）' : ''}
                    {document.isActive ? '' : '（無効）'}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-xs font-semibold text-white/70">
              型番/FHINCD
              <Input value={modelCode} disabled={busy || readOnly} onChange={(e) => setModelCode(e.target.value)} />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-white/70">
              手順パターン
              <Input value={procedurePattern} disabled={busy || readOnly} onChange={(e) => setProcedurePattern(e.target.value)} />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-white/70">
              テンプレート名
              <Input value={templateName} disabled={busy || readOnly} onChange={(e) => setTemplateName(e.target.value)} />
            </label>
          </div>
          <h2 className="mt-5 text-[1.02rem] font-bold">工程</h2>
          <div className="mt-2 flex flex-wrap gap-2">
            {areas.map((area) => (
              <Button
                key={area.id}
                type="button"
                variant={area.id === selectedAreaId ? 'primary' : 'ghostOnDark'}
                className="min-h-9 !px-2 !py-1 text-xs"
                onClick={() => {
                  setSelectedAreaId(area.id);
                  setSelectedBoltId(null);
                  setSelectedCheckItemId(null);
                }}
              >
                {area.processNo}-{area.areaCode}
              </Button>
            ))}
            <Button type="button" variant="ghostOnDark" className="min-h-9 !px-2 !py-1 text-xs" disabled={readOnly} onClick={addArea}>
              追加
            </Button>
          </div>
          {selectedArea ? (
            <div className="mt-3 grid grid-cols-2 gap-2">
              {([
                ['processNo', '工程No.'],
                ['areaCode', 'エリア'],
                ['unitCode', 'ユニット'],
                ['areaName', 'エリア名']
              ] as const).map(([key, label]) => (
                <label key={key} className={clsx('grid gap-1 text-xs font-semibold text-white/70', key === 'areaName' ? 'col-span-2' : '')}>
                  {label}
                  <Input
                    value={selectedArea[key]}
                    disabled={busy || readOnly}
                    onChange={(e) => setAreaPatch(selectedArea.id, { [key]: e.target.value })}
                  />
                </label>
              ))}
            </div>
          ) : null}
        </section>

        <section className="flex min-h-[32rem] flex-col overflow-hidden rounded border border-white/15 bg-slate-900/70 xl:min-h-0">
          <div className="shrink-0 border-b border-white/10 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="text-[1.02rem] font-bold">手順書 / マーカー</h2>
                <p className="mt-1 truncate text-sm text-white/60">{selectedPage?.label ?? selectedDocument?.name ?? '手順書未選択'}</p>
              </div>
              <ImageCanvasZoomControls
                enabled={Boolean(selectedPage?.imageRelativePath ?? selectedDocument?.imageRelativePath)}
                onZoomIn={canvasZoom.zoomIn}
                onZoomOut={canvasZoom.zoomOut}
                onFitToView={canvasZoom.fitToView}
                controlsClassName="shrink-0 rounded bg-slate-950/70 p-1"
              />
            </div>
            <div className="mt-2 grid gap-2">
              <label className="grid gap-1 text-xs font-semibold text-white/70">
                ページ
                <select
                  className="min-h-9 rounded border border-white/10 bg-slate-950 px-2 text-sm text-white"
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
              </label>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant={markerMode === 'bolt' ? 'primary' : 'ghostOnDark'}
                  className="min-h-9 !px-2 !py-1 text-xs"
                  disabled={readOnly}
                  onClick={() => {
                    setMarkerMode('bolt');
                    setSelectedCheckItemId(null);
                  }}
                >
                  締結マーカー
                </Button>
                <Button
                  type="button"
                  variant={markerMode === 'check' ? 'primary' : 'ghostOnDark'}
                  className="min-h-9 !px-2 !py-1 text-xs"
                  disabled={readOnly}
                  onClick={() => {
                    setMarkerMode('check');
                    setSelectedBoltId(null);
                  }}
                >
                  チェックマーカー
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-white/55">操作</span>
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
                  disabled={
                    readOnly ||
                    (markerMode === 'bolt' ? !selectedBolt : !selectedCheckItem)
                  }
                  aria-pressed={placementAction === 'callout'}
                  onClick={() => setPlacementAction('callout')}
                >
                  矢視
                </Button>
              </div>
              <p className="text-[0.72rem] font-semibold text-white/50">
                {placementAction === 'callout'
                  ? '選択中マーカーの矢視先端を手順書上でタップ。'
                  : markerMode === 'bolt'
                    ? '白/シアン: 締結位置。手順書をタップして追加。'
                    : '緑系: チェック位置。手順書をタップして追加。'}
              </p>
            </div>
          </div>
          <div className="min-h-0 flex-1">
            <AssemblyProcedureCanvas
              imageRelativePath={selectedPage?.imageRelativePath ?? selectedDocument?.imageRelativePath}
              bolts={visibleBolts}
              checkItems={visibleCheckItems}
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
              onAddBolt={readOnly || markerMode !== 'bolt' || placementAction !== 'place' ? undefined : addBoltAt}
              onAddCheckItem={readOnly || markerMode !== 'check' || placementAction !== 'place' ? undefined : addCheckItemAt}
              onPlaceCallout={
                readOnly || placementAction !== 'callout' || (markerMode === 'bolt' ? !selectedBolt : !selectedCheckItem)
                  ? undefined
                  : placeSelectedCalloutAt
              }
              placementMode={markerMode}
              placementAction={placementAction}
              zoom={canvasZoom.zoom}
              fitGeneration={canvasZoom.fitGeneration}
              className="h-full"
            />
          </div>
        </section>

        <section className="min-h-0 overflow-y-auto rounded border border-white/15 bg-slate-900/70 p-3">
          {markerMode === 'bolt' ? (
            <>
              <h2 className="text-[1.02rem] font-bold">締付条件</h2>
              {selectedBolt ? (
                <div className="mt-3 grid gap-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-bold">丸数字 {selectedBolt.markerNo}</div>
                    <Button type="button" variant="danger" className="min-h-8 !px-2 !py-1 text-xs" disabled={busy || readOnly} onClick={deleteSelectedBolt}>
                      削除
                    </Button>
                  </div>
                  <div className="flex min-h-9 items-center justify-between gap-2 rounded border border-white/10 bg-slate-950/60 px-2">
                    <span className="text-xs font-semibold text-white/70">
                      {imageMarkerHasCalloutTip(selectedBolt) ? '矢視 あり' : '矢視 なし'}
                    </span>
                    <Button
                      type="button"
                      variant="ghostOnDark"
                      className="min-h-8 !px-2 !py-1 text-xs"
                      disabled={busy || readOnly || !imageMarkerHasCalloutTip(selectedBolt)}
                      onClick={() => setBoltPatch(selectedBolt.id, clearImageMarkerCalloutTip())}
                    >
                      矢視削除
                    </Button>
                  </div>
                  <p className="text-xs text-white/55">
                    ページ: {selectedPage ? pageRefKey(currentPageRef!) : '未設定'}
                  </p>
                  <label className="grid gap-1 text-xs font-semibold text-white/70">
                    締付ID
                    <Input value={selectedBolt.tighteningId} disabled={busy || readOnly} onChange={(e) => setBoltPatch(selectedBolt.id, { tighteningId: e.target.value })} />
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="grid gap-1 text-xs font-semibold text-white/70">
                      ボルト
                      <Input value={selectedBolt.boltSpec} disabled={busy || readOnly} onChange={(e) => setBoltPatch(selectedBolt.id, { boltSpec: e.target.value })} />
                    </label>
                    <label className="grid gap-1 text-xs font-semibold text-white/70">
                      単位
                      <Input value={selectedBolt.unit} disabled={busy || readOnly} onChange={(e) => setBoltPatch(selectedBolt.id, { unit: e.target.value })} />
                    </label>
                    {([
                      ['nominalTorque', '規定'],
                      ['lowerLimit', '下限'],
                      ['upperLimit', '上限']
                    ] as const).map(([key, label]) => (
                      <label key={key} className="grid gap-1 text-xs font-semibold text-white/70">
                        {label}
                        <Input
                          type="number"
                          value={selectedBolt[key]}
                          disabled={busy || readOnly}
                          onChange={(e) => setBoltPatch(selectedBolt.id, { [key]: Number(e.target.value) })}
                        />
                      </label>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="mt-3 rounded border border-dashed border-white/20 p-3 text-sm text-white/60">
                  手順書上の締結マーカーを選択
                </div>
              )}
            </>
          ) : (
            <>
              <h2 className="text-[1.02rem] font-bold">チェック項目</h2>
              {selectedCheckItem ? (
                <div className="mt-3 grid gap-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-bold">チェック {selectedCheckItem.markerNo}</div>
                    <Button type="button" variant="danger" className="min-h-8 !px-2 !py-1 text-xs" disabled={busy || readOnly} onClick={deleteSelectedCheckItem}>
                      削除
                    </Button>
                  </div>
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
                  <label className="grid gap-1 text-xs font-semibold text-white/70">
                    ラベル
                    <Input
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
      </div>
    </div>
  );
}
