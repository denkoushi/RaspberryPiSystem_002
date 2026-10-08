import { isAxiosError } from 'axios';
import { useEffect, useRef, useState } from 'react';

import { createProcedureMaterialDocument, getProcedureMaterialThumbnail, getProcedureKnowledgeThumbnail, getProcedureWorkInstructionThumbnail, getProcedureWorkInstructionImage, importProcedureWorkInstructions, discardProcedureMaterial, getProcedureMaterialFile, getProcedureKnowledgeImage, importProcedureKnowledge, ingestProcedureMaterialsGmail, restoreProcedureMaterial, unplaceProcedureMaterial } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { Dialog } from '../../../components/ui/Dialog';
import { Input } from '../../../components/ui/Input';
import { readAssemblyApiErrorMessage } from '../assemblyUiHelpers';

import { groupMaterials, groupWorkInstructionCandidates, materialSource } from './procedure-material-grouping';
import { ProcedureMaterialPhotoCache } from './procedure-material-photo-cache';
import { emptyShelfFilters, filterShelfKnowledge, filterShelfMaterials, filterShelfWorkInstructions, ShelfFilterChips, ShelfHighlight, normalizeShelfQuery, shelfMatchExcerpt, shelfTabs, useShelfLists, workHasDates } from './procedure-material-shelf-search';

import type { ShelfFilters } from './procedure-material-shelf-search';
import type { ProcedureWorkInstructionCandidate, ProcedureKnowledgeCandidate, ProcedureKnowledgeImportResult, ProcedureMaterialDto, ProcedureMaterialIngestResult, ProcedureMaterialState } from './procedure-material-types';
import type { ReactNode } from 'react';

function MaterialPhoto({ id, alt, cache, knowledge = false, workInstruction = false, compact = false, onZoom }: { id: string; alt: string; cache: ProcedureMaterialPhotoCache; knowledge?: boolean; workInstruction?: boolean; compact?: boolean; onZoom: (load: () => Promise<Blob>, title: string) => void }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let request: ReturnType<ProcedureMaterialPhotoCache['request']> | undefined;
    let observer: IntersectionObserver | undefined;
    setUrl(null); setFailed(false);
    const load = () => {
      if (request || cancelled) return;
      const next = cache.request(`${workInstruction ? 'work' : knowledge ? 'knowledge' : 'material'}:${id}`,
        () => workInstruction ? getProcedureWorkInstructionThumbnail(id) : knowledge ? getProcedureKnowledgeThumbnail(id) : getProcedureMaterialThumbnail(id));
      request = next;
      void next.promise.then((objectUrl) => {
        if (cancelled || request !== next) return;
        setUrl(objectUrl); observer?.disconnect();
      }).catch(() => { if (!cancelled && request === next) { setFailed(true); observer?.disconnect(); } });
    };
    if (typeof IntersectionObserver === 'undefined') load();
    else {
      observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) load();
        else { request?.release(); request = undefined; }
      });
      if (cardRef.current) observer.observe(cardRef.current);
    }
    return () => { cancelled = true; observer?.disconnect(); request?.release(); };
  }, [cache, id, knowledge, workInstruction]);
  return <div ref={cardRef} className={`relative flex items-center justify-center bg-gradient-to-br from-[#30404f] to-[#1b222a] ${compact ? 'h-full w-full' : 'aspect-[4/3]'}`}>
    {url ? <img src={url} alt={alt} loading="lazy" className="h-full w-full object-contain" /> : <p className={`${compact ? 'text-xs' : 'text-lg'} text-[#9fadb9]`}>{failed ? '写真を取得できません' : '読込中…'}</p>}
    {compact ? null : <button aria-label={`${alt}を原寸表示`} disabled={!url} className="absolute bottom-2.5 right-2.5 grid h-11 w-11 place-items-center rounded-lg border border-white/50 bg-black/45 text-lg text-white disabled:opacity-40" onClick={() => onZoom(() => workInstruction ? getProcedureWorkInstructionImage(id) : knowledge ? getProcedureKnowledgeImage(id) : getProcedureMaterialFile(id), alt)}>⤢</button>}
  </div>;
}

function useShelfSearch(value: string, composing: boolean) {
  const [query, setQuery] = useState(value);
  useEffect(() => {
    if (composing) return;
    const timer = window.setTimeout(() => setQuery(value), 300);
    return () => window.clearTimeout(timer);
  }, [value, composing]);
  return query;
}

function MaterialCard({ title, query = '', source, date, checked, disabled, onChange, children, detail }: {
  title: string; query?: string; source: string; date?: string; checked: boolean; disabled: boolean;
  onChange: (checked: boolean) => void; children: ReactNode; detail?: ReactNode;
}) {
  return <li className={`relative overflow-hidden rounded-xl border border-[#344252] bg-[#1b222a] ${checked ? 'outline outline-[3px] -outline-offset-[3px] outline-[#3ba776]' : ''}`}>
    {children}
    <input type="checkbox" aria-label={title} checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} className="absolute left-2.5 top-2.5 h-11 w-11 cursor-pointer accent-[#3ba776] disabled:cursor-default" />
    <div className="flex min-h-12 min-w-0 items-center gap-2.5 px-3 py-2.5 text-[17px] text-[#9fadb9]">
      <b className="min-w-0 flex-1 truncate text-[19px] text-[#eef3f6]" title={title}><ShelfHighlight text={title} query={query} /></b>
      <span className="shrink-0 rounded-full border border-[#344252] px-2 py-0.5 text-sm">{source}</span>
      {date ? <time className="shrink-0" dateTime={date}>{new Date(date).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</time> : null}
    </div>
    {detail ? <div className="px-3 pb-2 text-sm text-[#9fadb9]">{detail}</div> : null}
  </li>;
}

function MaterialBundle({ title, query = '', subtitle, count, photoCount, open, onToggle, onSelectAll, disabled, children }: {
  title: string; query?: string; subtitle: string; count: number; photoCount?: boolean; open: boolean;
  onToggle: () => void; onSelectAll?: () => void; disabled: boolean; children: ReactNode;
}) {
  return <details open={open} className="rounded-xl border border-[#344252] bg-[#1b222a]">
    <summary role="button" tabIndex={0} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onToggle(); } }} aria-expanded={open} className="grid min-h-[52px] cursor-pointer list-none grid-cols-[28px_minmax(0,1fr)_auto_auto] items-center gap-3 px-3.5 text-[19px] font-bold [&::-webkit-details-marker]:hidden" onClick={(event) => { event.preventDefault(); onToggle(); }}>
      <span aria-hidden="true" className="text-sm text-[#9fadb9]">{open ? '▼' : '▶'}</span>
      <span className="min-w-0"><ShelfHighlight text={title} query={query} /> <span className="text-base font-medium text-[#9fadb9]">{subtitle}</span></span>
      <span className="rounded-full bg-[#27313b] px-3 py-0.5 text-base font-semibold tabular-nums">{count} {photoCount ? '枚' : '件'}</span>
      {onSelectAll ? <button type="button" disabled={disabled} className="relative h-9 rounded-lg border border-[#344252] px-3 text-[15px] font-normal text-[#9fadb9] before:absolute before:-inset-y-1 before:inset-x-0 disabled:opacity-40" onClick={(event) => { event.stopPropagation(); onSelectAll(); }}>束を全部選ぶ</button> : null}
    </summary>
    {open ? children : null}
  </details>;
}

const shelfSizeKey = 'procedure-material-shelf-size';
type ShelfSize = 'small' | 'medium' | 'large';
const shelfColumns = { small: 6, medium: 4, large: 3 };
const emptyMaterials: ProcedureMaterialDto[] = [];


export function ProcedureMaterialShelfDialog({ onClose, onSelect, onCreatedDocument, mode = 'place' }: { onCreatedDocument?: (documentId: string) => void; onClose: () => void; onSelect?: (material: ProcedureMaterialDto) => Promise<void>; mode?: 'place' | 'replace' }) {
  const selectionMode = Boolean(onSelect);
  const [size, setSize] = useState<ShelfSize>(() => {
    try { const saved = localStorage.getItem(shelfSizeKey); if (saved === 'small' || saved === 'large') return saved; } catch { /* Storage is optional on kiosks. */ }
    return 'medium';
  });
  const changeSize = (next: ShelfSize) => {
    setSize(next);
    try { localStorage.setItem(shelfSizeKey, next); } catch { /* Keep the in-memory setting. */ }
  };
  const [lightbox, setLightbox] = useState<{ url: string | null; title: string; failed?: boolean } | null>(null);
  const [photoCache] = useState(() => new ProcedureMaterialPhotoCache());
  const zoomSequence = useRef(0);
  useEffect(() => () => { photoCache.clear(); zoomSequence.current++; }, [photoCache]);
  useEffect(() => { const url = lightbox?.url; return () => { if (url) URL.revokeObjectURL(url); }; }, [lightbox?.url]);
  const [discardConfirm, setDiscardConfirm] = useState(false);
  const closeLightbox = () => { zoomSequence.current++; setLightbox(null); };
  const zoom = (load: () => Promise<Blob>, title: string) => {
    const sequence = ++zoomSequence.current;
    setLightbox({ url: null, title });
    void load().then((blob) => { if (sequence === zoomSequence.current) setLightbox({ url: URL.createObjectURL(blob), title }); })
      .catch(() => { if (sequence === zoomSequence.current) setLightbox({ url: null, title, failed: true }); });
  };
  const toggleSelected = (id: string, checked: boolean) => { setDiscarded([]); setSelected((ids) => checked ? mode === 'replace' ? [id] : [...ids, id] : ids.filter((item) => item !== id)); };
  const [q, setQ] = useState('');
  const [state, setState] = useState<ProcedureMaterialState | 'knowledge' | 'workInstruction'>('unplaced');
  const [composing, setComposing] = useState(false);
  const query = useShelfSearch(q, composing).trim();
  const [filters, setFilters] = useState<ShelfFilters>(emptyShelfFilters);
  const filtered = Boolean(query || filters.sources.length || filters.kinds.length || filters.days);
  const [openGroups, setOpenGroups] = useState<Map<string, boolean>>(() => new Map());
  useEffect(() => { setOpenGroups(new Map()); }, [state]);
  const [selected, setSelected] = useState<string[]>([]);
  const [discarded, setDiscarded] = useState<string[]>([]);
  const retainSelectionOnRefresh = useRef(false);
  useEffect(() => { setDiscarded([]); }, [q, state, filters]);
  const closeShelf = () => { setDiscarded([]); onClose(); };
  const [knowledgeResult, setKnowledgeResult] = useState<ProcedureKnowledgeImportResult | null>(null);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdMessage, setCreatedMessage] = useState<string | null>(null);
  const [result, setResult] = useState<ProcedureMaterialIngestResult | null>(null);
  const lists = useShelfLists(state, query, filtered, version);
  const materials = lists.data?.materials ?? emptyMaterials;
  const knowledge = lists.data?.knowledge;
  const workInstructions = lists.data?.workInstructions;
  const loading = lists.loading;
  const visibleMaterials = filterShelfMaterials(materials, filters);
  const visibleKnowledge = filterShelfKnowledge(knowledge?.items ?? [], filters);
  const visibleWork = filterShelfWorkInstructions(workInstructions?.items ?? [], filters);
  const visibleIds = new Set(state === 'knowledge' ? visibleKnowledge.map((item) => item.candidateKey) : state === 'workInstruction' ? visibleWork.map((item) => item.candidateKey) : visibleMaterials.map((item) => item.id));
  const visibleSelected = selected.filter((id) => visibleIds.has(id));
  const hiddenSelectedCount = selected.length - visibleSelected.length;
  const discardReady = !composing && q.trim() === query && !loading && visibleSelected.length > 0;
  const visibleCount = state === 'knowledge' ? visibleKnowledge.length : state === 'workInstruction' ? visibleWork.length : visibleMaterials.length;
  const retained = useRef(new Map<string, { material?: ProcedureMaterialDto; knowledge?: ProcedureKnowledgeCandidate; work?: ProcedureWorkInstructionCandidate }>());
  useEffect(() => {
    if (retainSelectionOnRefresh.current) { retainSelectionOnRefresh.current = false; return; }
    setSelected([]); setError(null); retained.current.clear();
  }, [state, version]);
  useEffect(() => {
    for (const material of materials) retained.current.set(material.id, { material });
    for (const candidate of knowledge?.items ?? []) retained.current.set(candidate.candidateKey, { knowledge: candidate });
    for (const candidate of workInstructions?.items ?? []) retained.current.set(candidate.candidateKey, { work: candidate });
  }, [materials, knowledge, workInstructions, state, version]);

  const importSelected = async () => {
    setBusy(true); setError(null); setKnowledgeResult(null);
    try {
      const next = await (state === 'workInstruction' ? importProcedureWorkInstructions(selected.flatMap((id) => {
        const candidate = retained.current.get(id)?.work;
        return candidate ? [{ candidateKey: candidate.candidateKey, partNumber: candidate.partNumber, shootingTarget: candidate.shootingTarget }] : [];
      })) : importProcedureKnowledge(selected));
      setKnowledgeResult(next); setSelected([]); setVersion((v) => v + 1);
      if (!next.failed.length) { setQ(''); setState('unplaced'); }
    } catch (e) { setError(isAxiosError(e) && e.response?.status === 403 ? '権限がありません' : readAssemblyApiErrorMessage(e, '取込に失敗しました')); }
    finally { setBusy(false); }
  };
  const runNow = async () => {
    setBusy(true); setError(null); setResult(null);
    try { setResult(await ingestProcedureMaterialsGmail()); setVersion((v) => v + 1); }
    catch (e) { setError(isAxiosError(e) && e.response?.status === 403 ? '権限がありません' : readAssemblyApiErrorMessage(e, '取込に失敗しました')); }
    finally { setBusy(false); }
  };
  const createDocument = async (material: ProcedureMaterialDto) => {
    if (busy) return;
    setBusy(true); setError(null); setCreatedMessage(null);
    try {
      const document = await createProcedureMaterialDocument(material.id);
      setCreatedMessage(`要領書『${document.name}』を作成しました`);
      setSelected((ids) => ids.filter((id) => id !== material.id));
      setVersion((v) => v + 1);
      onCreatedDocument?.(document.id);
    } catch (e) { setError(isAxiosError(e) && e.response?.status === 403 ? '権限がありません' : readAssemblyApiErrorMessage(e, '要領書を作成できません')); }
    finally { setBusy(false); }
  };
  const toggleDiscard = async (material: ProcedureMaterialDto) => {
    setBusy(true); setError(null);
    try {
      if (material.documentId || material.placedAt) await unplaceProcedureMaterial(material.id);
      else if (material.discardedAt) await restoreProcedureMaterial(material.id);
      else await discardProcedureMaterial(material.id);
      setVersion((v) => v + 1);
    } catch (e) { setError(isAxiosError(e) && e.response?.status === 403 ? '権限がありません' : readAssemblyApiErrorMessage(e, '素材を変更できません')); }
    finally { setBusy(false); }
  };
  const placeSelected = async () => {
    if (!onSelect || busy) return;
    setBusy(true); setError(null);
    try {
      for (const id of selected) {
        const material = retained.current.get(id)?.material;
        if (!material || material.kind === 'PDF') continue;
        await onSelect(material);
        setSelected((ids) => ids.filter((item) => item !== id));
        if (state === 'unplaced') lists.removeUnplaced(id);
      }
      closeShelf();
    } catch (e) { setError(isAxiosError(e) && e.response?.status === 403 ? '権限がありません' : readAssemblyApiErrorMessage(e, '素材を配置できません')); }
    finally { setBusy(false); }
  };
  const discardSelected = async () => {
    if (busy || state !== 'unplaced' || !discardReady) { setDiscardConfirm(false); return; }
    setDiscardConfirm(false); setBusy(true); setError(null); setDiscarded([]);
    const completed: string[] = [];
    try {
      for (const id of visibleSelected) {
        await discardProcedureMaterial(id);
        completed.push(id);
        setSelected((ids) => ids.filter((item) => item !== id));
        lists.removeUnplaced(id);
      }
    } catch (e) { setError(readAssemblyApiErrorMessage(e, '素材を変更できません')); }
    finally {
      if (completed.length) { setDiscarded(completed); retainSelectionOnRefresh.current = true; setVersion((v) => v + 1); }
      setBusy(false);
    }
  };
  const undoDiscard = async () => {
    if (busy || !discarded.length) return;
    setBusy(true); setError(null);
    const completed: string[] = [];
    try {
      for (const id of discarded) {
        await restoreProcedureMaterial(id);
        completed.push(id);
        setDiscarded((ids) => ids.filter((item) => item !== id));
      }
    } catch (e) { setError(isAxiosError(e) && e.response?.status === 403 ? '権限がありません' : readAssemblyApiErrorMessage(e, '素材を変更できません')); }
    finally {
      if (completed.length) { retainSelectionOnRefresh.current = true; setVersion((v) => v + 1); }
      setBusy(false);
    }
  };
  const materialDisabled = (material: ProcedureMaterialDto) => busy || (selectionMode && material.kind === 'PDF') || (state !== 'unplaced' && !(selectionMode && state === 'placed')) || (mode === 'replace' && material.kind !== 'PHOTO');
  const workInstructionDisabled = (candidate: ProcedureWorkInstructionCandidate) => busy || candidate.alreadyImported || (!selected.includes(candidate.candidateKey) && selected.length >= 50);
  const toggleGroup = (ids: string[], limit = Infinity) => { setDiscarded([]); setSelected((current) => ids.every((id) => current.includes(id))
    ? current.filter((id) => !ids.includes(id))
    : [...current, ...ids.filter((id) => !current.includes(id)).slice(0, Math.max(0, limit - current.length))]); };
  const gridStyle = { gridTemplateColumns: `repeat(${shelfColumns[size]}, minmax(0, 1fr))` };
  const renderWorkInstructions = (items: ProcedureWorkInstructionCandidate[]) => items.map((candidate) => <MaterialCard query={query} key={candidate.candidateKey} title={`${candidate.partNumber} ${candidate.shootingTarget} 手順 ${candidate.step}`} source="加工" checked={selected.includes(candidate.candidateKey)} disabled={workInstructionDisabled(candidate)} onChange={(checked) => setSelected((ids) => checked ? [...ids, candidate.candidateKey] : ids.filter((id) => id !== candidate.candidateKey))} detail={<><p><ShelfHighlight text={`${candidate.partNumber} ${candidate.shootingTarget} · 手順 ${candidate.step}`} query={query} />{candidate.alreadyImported ? ' · 取込済み' : ''}</p>{candidate.memo ? <p className="line-clamp-2 whitespace-pre-wrap break-words"><ShelfHighlight text={candidate.memo} query={query} /></p> : null}</>}>
            <MaterialPhoto cache={photoCache} id={candidate.assetId} alt={`${candidate.partNumber} ${candidate.shootingTarget} 手順 ${candidate.step}`} workInstruction onZoom={zoom} />
          </MaterialCard>);
  const bodyExcerpts = new Map<string, string>();
  for (const material of materials) {
    if (material.kind !== 'TEXT' || !material.gmailMessageId) continue;
    const excerpt = shelfMatchExcerpt(material.text ?? '', query);
    if (excerpt && !bodyExcerpts.has(material.gmailMessageId)) bodyExcerpts.set(material.gmailMessageId, excerpt);
  }
  const renderMaterials = (items: ProcedureMaterialDto[]) => items.map((material) => {
    const bodyExcerpt = material.kind !== 'TEXT' && material.gmailMessageId ? bodyExcerpts.get(material.gmailMessageId) : undefined;
    const text = material.text ?? '';
    const preview = normalizeShelfQuery(text.split('\n').slice(0, 2).join('\n')).includes(normalizeShelfQuery(query)) ? text : shelfMatchExcerpt(text, query) ?? text;
    return <MaterialCard query={query} key={material.id} title={material.subjectHint || material.originalFileName || 'ヒントなし'} source={materialSource(material)} date={material.receivedAt} checked={selected.includes(material.id)} disabled={materialDisabled(material)} onChange={(checked) => toggleSelected(material.id, checked)} detail={bodyExcerpt || material.kind === 'PDF' || (material.origin === 'WORK_INSTRUCTION' && material.workInstructionRef) || (state === 'placed' && !selectionMode) || state === 'discarded' ? <>{bodyExcerpt ? <p className="truncate"><ShelfHighlight text={bodyExcerpt} query={query} /></p> : null}{material.kind === 'PDF' ? <Button variant="ghostOnDark" className="min-h-11" disabled={busy || Boolean(material.documentId || material.placedAt || material.discardedAt)} onClick={() => void createDocument(material)}>要領書を作る</Button> : null}{material.origin === 'WORK_INSTRUCTION' && material.workInstructionRef ? <><p><ShelfHighlight text={`${material.workInstructionRef.partNumber} ${material.workInstructionRef.shootingTarget} · 手順 ${material.workInstructionRef.step}`} query={query} /></p>{material.workInstructionRef.memo ? <p className="line-clamp-2 whitespace-pre-wrap break-words"><ShelfHighlight text={material.workInstructionRef.memo} query={query} /></p> : null}</> : null}{(state === 'placed' && !selectionMode && material.kind !== 'PDF') || state === 'discarded' ? <Button variant="ghostOnDark" className="min-h-11" disabled={busy} onClick={() => void toggleDiscard(material)}>{state === 'placed' ? '配置を取り消す' : '戻す'}</Button> : null}</> : undefined}>
            {material.kind === 'PHOTO' ? <MaterialPhoto cache={photoCache} id={material.id} alt={material.originalFileName || '素材の写真'} onZoom={zoom} /> : material.kind === 'PDF' ? <div className="flex aspect-[4/3] items-center justify-center bg-[#27313b] text-3xl font-bold">PDF</div> : <div className="aspect-[4/3] overflow-hidden bg-[#fdfcf7] p-4 pt-14 text-[19px] leading-normal text-[#1a1a1a]"><p className="line-clamp-6 whitespace-pre-wrap break-words"><ShelfHighlight text={preview} query={query} /></p></div>}
          </MaterialCard>;
  });
  const renderKnowledge = (items: ProcedureKnowledgeCandidate[]) => items.map((candidate) => <MaterialCard query={query} key={candidate.candidateKey} title={candidate.title} source="ナレッジ" checked={selected.includes(candidate.candidateKey)} disabled={busy || candidate.alreadyImported || (mode === 'replace' && candidate.kind !== 'PHOTO') || (!selected.includes(candidate.candidateKey) && selected.length >= 50)} onChange={(checked) => toggleSelected(candidate.candidateKey, checked)} detail={<>{candidate.summary ? <p className="line-clamp-2"><ShelfHighlight text={candidate.summary} query={query} /></p> : null}<p>{candidate.kind === 'PHOTO' && candidate.preview ? <span className="line-clamp-2"><ShelfHighlight text={candidate.preview} query={query} /></span> : null}<ShelfHighlight text={candidate.sourceLabel} query={query} />{candidate.alreadyImported ? ' · 取込済み' : ''}</p></>}>
            {candidate.kind === 'PHOTO' && candidate.imageId ? <MaterialPhoto cache={photoCache} id={candidate.imageId} alt={candidate.title} knowledge onZoom={zoom} /> : <div className="aspect-[4/3] overflow-hidden bg-[#fdfcf7] p-4 pt-14 text-[19px] leading-normal text-[#1a1a1a]"><p className="line-clamp-6 whitespace-pre-wrap break-words"><ShelfHighlight text={candidate.preview} query={query} /></p></div>}
          </MaterialCard>);
  const toolClass = 'h-11 shrink-0 rounded-lg border border-[#344252] px-3.5 text-[19px] font-bold disabled:opacity-40';
  return (
    <>
    <Dialog isOpen onClose={() => { if (!busy) closeShelf(); }} ariaLabel="素材" size="full" closeOnEsc={!lightbox && !discardConfirm && !busy} closeOnBackdrop={!busy && !lightbox && !discardConfirm} trapFocus={!lightbox && !discardConfirm} className="!mx-auto !my-[calc((100dvh-min(980px,92dvh))/2-1rem)] flex !h-[min(980px,92dvh)] min-h-0 !max-h-[92dvh] !w-[min(1760px,92vw)] flex-col gap-3 !rounded-[14px] !border !border-[#344252] !bg-[#161c22] !px-[26px] !py-6 !text-[#eef3f6]">
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <h2 className="text-2xl font-black">素材</h2>
        <div className="relative ml-4 w-80 max-w-[40vw]">
          <Input type="search" disabled={busy} aria-label="素材を探す" placeholder="品番・ヒント・本文" className="h-11 !w-full pr-11 text-xl [&::-webkit-search-cancel-button]:hidden" maxLength={200} onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)} value={q} onChange={(e) => setQ(e.target.value)} />
          {q ? <button aria-label="検索語を消す" disabled={busy} className="absolute right-0 top-0 h-11 w-11 text-[#9fadb9]" onClick={() => setQ('')}>✕</button> : null}
        </div>
        <div role="group" aria-label="表示サイズ" className="ml-auto flex items-center gap-1 text-[17px] text-[#9fadb9]">表示 {([['small', '小'], ['medium', '中'], ['large', '大']] as const).map(([value, label]) => <button key={value} aria-pressed={size === value} className={`h-11 w-11 rounded-lg border border-[#344252] text-base font-bold text-[#eef3f6] ${size === value ? 'bg-[#27313b]' : ''}`} onClick={() => changeSize(value)}>{label}</button>)}</div>
        <button className={`${toolClass} border-transparent text-[#9fadb9]`} disabled={busy} onClick={() => void runNow()}>{busy ? '処理中…' : '今すぐ取り込む'}</button>
        <button className={`${toolClass} border-transparent text-[#9fadb9]`} disabled={busy} onClick={closeShelf}>閉じる</button>
      </div>
      <div role="tablist" aria-label="素材の種類" className="flex shrink-0 items-center gap-1">
        {shelfTabs.map(([value, label]) => {
          const data = lists.getData(value);
          const count = !data ? undefined : value === 'knowledge' ? filterShelfKnowledge(data.knowledge?.items ?? [], filters).length : value === 'workInstruction' ? filterShelfWorkInstructions(data.workInstructions?.items ?? [], filters).length : filterShelfMaterials(data.materials ?? [], filters).length;
          return <button key={value} role="tab" aria-selected={state === value} disabled={busy} className={`h-11 whitespace-nowrap rounded-lg px-4 text-[19px] font-bold ${state === value ? 'bg-[#27313b] text-[#eef3f6]' : filtered && count ? 'text-[#3ba776]' : 'text-[#9fadb9]'}`} onClick={() => setState(value)}>{label}{filtered && count !== undefined ? <span className={`ml-2 rounded-full bg-[#27313b] px-2 text-sm tabular-nums ${count ? 'text-[#3ba776]' : 'text-[#9fadb9]'}`}>{count}</span> : !filtered && value === 'unplaced' && state === value && !loading ? ` (${materials.length}${materials.length === 500 ? '+' : ''})` : ''}</button>;
        })}
        <div className="ml-auto">{!selectionMode ? <button className={`${toolClass} border-transparent text-[#9fadb9]`} aria-pressed={state === 'discarded'} disabled={busy} onClick={() => setState('discarded')}>捨てた素材</button> : null}</div>
      </div>
      <ShelfFilterChips tab={state} hasWorkDates={workHasDates(workInstructions?.items ?? [])} filters={filters} disabled={busy} onChange={setFilters} />
      {error || lists.error ? <p role="alert" className="shrink-0 text-sm text-red-400">{error || lists.error}</p> : null}
      {createdMessage ? <p role="status" className="shrink-0 text-sm text-[#9fadb9]">{createdMessage}</p> : null}
      {knowledgeResult ? <div role="status" className="max-h-24 shrink-0 overflow-auto text-sm text-[#9fadb9]">
        <p>取込 {knowledgeResult.imported}件・取込済み {knowledgeResult.duplicate}件・失敗 {knowledgeResult.failed.length}件</p>
        {knowledgeResult.failed.map((failure) => <p key={failure.candidateKey}>{failure.reason}</p>)}
      </div> : null}
      {result ? <div role="status" className="max-h-24 shrink-0 overflow-auto text-sm text-[#9fadb9]">
        <p>見つけた {result.scanned} 通・取込 {result.saved}件・保存済み {result.duplicate}件・スキップ {result.skipped}通・再試行 {result.retryable}通・再試行待ち {result.deferred}通・除外添付 {result.skippedAttachments}件</p>
        {result.scanned === 0 ? <p>受信トレイに未読の対象メールがありません</p> : null}
        {result.messages.filter((m) => m.reason || m.warnings.length).map((m) => <div key={m.messageId}>
          {m.reason ? <p>{m.reason}</p> : null}
          {m.warnings.map((warning, index) => <p key={`${index}:${warning}`} className="break-all">{warning}</p>)}
        </div>)}
      </div> : null}
      {!loading && !lists.error ? <p role="status" aria-label="一致件数" className="shrink-0 text-sm text-[#9fadb9]">{visibleCount ? `${visibleCount} 件` : '見つかりません'}</p> : null}
      <div className="min-h-0 flex-1 overflow-auto" aria-label="素材一覧">
        {loading ? <p role="status">読込中…</p> : state === 'knowledge' && knowledge?.enabled === false ? <p>ナレッジ機能は無効です</p> : null}
        {filtered ? <ul className="grid content-start gap-3.5 pr-1" style={gridStyle}>{state === 'workInstruction' ? renderWorkInstructions([...visibleWork].sort((a, b) => (Date.parse(b.sourceModified ?? '') || 0) - (Date.parse(a.sourceModified ?? '') || 0))) : state === 'knowledge' ? renderKnowledge(visibleKnowledge) : renderMaterials([...visibleMaterials].sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt)))}</ul> : state === 'workInstruction' ? <div className="grid content-start gap-2.5 pr-1">
          {groupWorkInstructionCandidates(workInstructions?.items ?? []).map(({ key, title, subtitle, items }, index) => {
            const open = openGroups.get(key) ?? index === 0;
            const selectable = items.filter((item) => !workInstructionDisabled(item)).map((item) => item.candidateKey);
            return <MaterialBundle query={query} key={key} title={title} subtitle={subtitle} count={items.length} photoCount open={open} onToggle={() => { setOpenGroups((groups) => new Map(groups).set(key, !open)); }} onSelectAll={mode === 'replace' ? undefined : () => toggleGroup(selectable, 50)} disabled={!selectable.length}>
              <ul className="grid content-start gap-3.5 px-3.5 pb-3.5" style={gridStyle}>{renderWorkInstructions(items)}</ul>
            </MaterialBundle>;
          })}
        </div> : state === 'unplaced' || state === 'placed' ? <div className="grid content-start gap-2.5 pr-1">
          {groupMaterials(materials).map(({ key, title, subtitle, items }, index) => {
            const open = openGroups.get(key) ?? index === 0;
            const selectable = items.filter((item) => !materialDisabled(item)).map((item) => item.id);
            return <MaterialBundle query={query} key={key} title={title} subtitle={subtitle} count={items.length} open={open} onToggle={() => { setOpenGroups((groups) => new Map(groups).set(key, !open)); }} onSelectAll={mode === 'replace' ? undefined : () => toggleGroup(selectable)} disabled={!selectable.length}>
              <ul className="grid content-start gap-3.5 px-3.5 pb-3.5" style={gridStyle}>{renderMaterials(items)}</ul>
            </MaterialBundle>;
          })}
        </div> : <ul className="grid content-start gap-3.5 pr-1" style={gridStyle}>
          {state === 'knowledge' ? renderKnowledge(visibleKnowledge) : renderMaterials(materials)}
        </ul>}
      </div>
      <div className={`flex shrink-0 items-center gap-3 text-[19px] text-[#9fadb9] ${selected.length || discarded.length ? 'border-t border-[#344252] pt-3' : 'sr-only'}`}>
        <span role="status" aria-label="選択中の素材" className={selected.length ? 'shrink-0' : 'sr-only'}><b className="font-mono font-medium text-[#eef3f6]">{selected.length}</b> 件を選択中{hiddenSelectedCount ? `(表示外 ${hiddenSelectedCount})` : ''}</span>
        {selected.length ? <>
        <button className={`${toolClass} border-transparent text-[#9fadb9]`} disabled={busy} onClick={() => { setDiscarded([]); setSelected([]); }}>選択を外す</button>
        {state === 'unplaced' ? <button className={toolClass} disabled={busy || !discardReady} onClick={() => setDiscardConfirm(true)}>捨てる</button> : null}
        </> : null}
        {discarded.length ? <><span role="status" className="flex min-h-12 shrink-0 items-center">{discarded.length} 件を捨てました</span><button className={toolClass} disabled={busy} onClick={() => void undoDiscard()}>元に戻す</button></> : null}
        {selected.length ? <>
        <div aria-label="選択した素材のサムネイル" className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto">{selected.map((id) => {
          const item = retained.current.get(id);
          const photoId = item?.work?.assetId ?? item?.knowledge?.imageId ?? (item?.material?.kind === 'PHOTO' ? id : undefined);
          const title = item?.work ? `${item.work.partNumber} ${item.work.shootingTarget} 手順 ${item.work.step}` : item?.knowledge?.title ?? item?.material?.subjectHint ?? item?.material?.originalFileName ?? '素材';
          return <div key={id} title={title} className="h-12 w-16 shrink-0 overflow-hidden rounded-md border border-[#344252] bg-[#27313b]">{photoId ? <MaterialPhoto compact cache={photoCache} id={photoId} alt={title} knowledge={Boolean(item?.knowledge)} workInstruction={Boolean(item?.work)} onZoom={zoom} /> : <span className="grid h-full place-items-center text-sm">{item?.material?.kind === 'PDF' ? 'PDF' : '文章'}</span>}</div>;
        })}</div>
        {state === 'knowledge' || state === 'workInstruction' ? <button className={`${toolClass} bg-[#3ba776] text-[#0b1a12]`} disabled={busy || !selected.length} onClick={() => void importSelected()}>棚に取り込む</button> : state === 'unplaced' || state === 'placed' ? <>
          {onSelect ? <button className={`${toolClass} !h-[52px] !rounded-[10px] bg-[#3ba776] !px-[22px] !text-[21px] text-[#0b1a12]`} disabled={busy || !selected.length} onClick={() => void placeSelected()}>{mode === 'replace' ? 'この素材に差し替え' : '現在ページに配置'}</button> : null}
        </> : null}
        </> : null}
      </div>
    </Dialog>
    {lightbox ? <Dialog isOpen title={lightbox.title} ariaLabel="素材の原寸表示" size="full" overlayZIndex={60} className="flex min-h-0 !h-[92dvh] flex-col !bg-[#161c22] !text-[#eef3f6]" onClose={closeLightbox}>
      <button className={`${toolClass} ml-auto mb-3`} onClick={closeLightbox}>閉じる</button>
      <div className="min-h-0 flex-1 overflow-auto">{lightbox.url ? <img src={lightbox.url} alt={lightbox.title} className="mx-auto block max-w-none" /> : <p role={lightbox.failed ? 'alert' : 'status'}>{lightbox.failed ? '写真を取得できません' : '読込中…'}</p>}</div>
    </Dialog> : null}
    {discardConfirm ? <Dialog isOpen title="素材を捨てる" overlayZIndex={60} onClose={() => setDiscardConfirm(false)}>
      <p className="my-3">選択した {visibleSelected.length} 件を捨てますか？捨てた素材から戻せます。</p>
      <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setDiscardConfirm(false)}>キャンセル</Button><Button variant="danger" disabled={busy || !discardReady} onClick={() => void discardSelected()}>捨てる</Button></div>
    </Dialog> : null}
    </>
  );
}
