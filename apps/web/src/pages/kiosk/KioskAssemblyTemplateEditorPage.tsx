import clsx from 'clsx';
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';

import {
  createAssemblyTemplate,
  getAssemblyTemplate,
  listAssemblyProcedureDocumentSummaries,
  reviseAssemblyTemplate
} from '../../api/client';
import { Button, buttonClassName } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import {
  AssemblyProcedureCanvas,
  createAssemblyBoltAt,
  draftAreasToInput,
  draftToCanvasBolts,
  emptyAssemblyArea,
  kioskAssemblyTemplateEditPath,
  kioskAssemblyTemplateNewPath,
  KIOSK_ASSEMBLY_LIBRARY_PATH,
  parseAssemblyTemplateNewSearch,
  readAssemblyApiErrorMessage,
  templateToDraftAreas
} from '../../features/assembly';

import type { AssemblyDraftArea, AssemblyDraftBolt } from '../../features/assembly';
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
  const [selectedAreaId, setSelectedAreaId] = useState('');
  const [selectedBoltId, setSelectedBoltId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const readOnly = Boolean(templateId && loadedTemplate && !loadedTemplate.isActive);
  const selectedDocument = useMemo(
    () => documents.find((document) => document.id === selectedDocumentId) ?? loadedTemplate?.procedureDocument ?? null,
    [documents, loadedTemplate?.procedureDocument, selectedDocumentId]
  );
  const selectedArea = areas.find((area) => area.id === selectedAreaId) ?? areas[0] ?? null;
  const selectedBolt = selectedArea?.bolts.find((bolt) => bolt.id === selectedBoltId) ?? null;

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
          setAreas(nextAreas.length > 0 ? nextAreas : [emptyAssemblyArea()]);
          setSelectedAreaId(selectFirstAreaId(nextAreas));
          setSelectedBoltId(null);
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

  const addArea = () => {
    const next = emptyAssemblyArea(areas.length);
    setAreas((prev) => [...prev, next]);
    setSelectedAreaId(next.id);
    setSelectedBoltId(null);
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

  const addBoltAt = (xRatio: number, yRatio: number) => {
    if (readOnly || !selectedArea) return;
    const next = createAssemblyBoltAt(selectedArea, xRatio, yRatio);
    setAreas((prev) => prev.map((area) => (area.id === selectedArea.id ? { ...area, bolts: [...area.bolts, next] } : area)));
    setSelectedBoltId(next.id);
  };

  const saveTemplate = async () => {
    if (readOnly) return;
    setBusy(true);
    setMessage(null);
    try {
      if (!selectedDocumentId) throw new Error('手順書を選択してください。');
      if (selectedDocument && !selectedDocument.isActive) throw new Error('有効な手順書を選択してください。');
      const payload = {
        name: templateName,
        modelCode,
        procedurePattern,
        procedureDocumentId: selectedDocumentId,
        areas: draftAreasToInput(areas)
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
                    {document.name}{document.isActive ? '' : '（無効）'}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-xs font-semibold text-white/70">
              形番/FHINCD
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
            <h2 className="text-[1.02rem] font-bold">手順書 / 丸数字</h2>
            <p className="mt-1 truncate text-sm text-white/60">{selectedDocument?.name ?? '手順書未選択'}</p>
          </div>
          <div className="min-h-0 flex-1">
            <AssemblyProcedureCanvas
              imageRelativePath={selectedDocument?.imageRelativePath}
              bolts={draftToCanvasBolts(areas)}
              selectedBoltId={selectedBoltId}
              onSelectBolt={setSelectedBoltId}
              onAddBolt={readOnly ? undefined : addBoltAt}
              className="h-full"
            />
          </div>
        </section>

        <section className="min-h-0 overflow-y-auto rounded border border-white/15 bg-slate-900/70 p-3">
          <h2 className="text-[1.02rem] font-bold">締付条件</h2>
          {selectedBolt ? (
            <div className="mt-3 grid gap-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-bold">丸数字 {selectedBolt.markerNo}</div>
                <Button type="button" variant="danger" className="min-h-8 !px-2 !py-1 text-xs" disabled={busy || readOnly} onClick={deleteSelectedBolt}>
                  削除
                </Button>
              </div>
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
              手順書上の丸数字を選択
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
