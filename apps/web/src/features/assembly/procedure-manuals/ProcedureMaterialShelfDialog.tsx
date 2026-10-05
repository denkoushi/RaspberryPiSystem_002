import { isAxiosError } from 'axios';
import { useEffect, useRef, useState } from 'react';

import { discardProcedureMaterial, getProcedureMaterialFile, getProcedureKnowledgeImage, importProcedureKnowledge, ingestProcedureMaterialsGmail, listProcedureKnowledgeCandidates, listProcedureMaterials, restoreProcedureMaterial, unplaceProcedureMaterial } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { Dialog } from '../../../components/ui/Dialog';
import { Input } from '../../../components/ui/Input';
import { readAssemblyApiErrorMessage } from '../assemblyUiHelpers';

import type { ProcedureKnowledgeCandidatesResult, ProcedureKnowledgeImportResult, ProcedureMaterialDto, ProcedureMaterialIngestResult, ProcedureMaterialState } from './procedure-material-types';
import type { ReactNode } from 'react';

function MaterialPhoto({ id, alt, knowledge = false, onZoom }: { id: string; alt: string; knowledge?: boolean; onZoom: (url: string, title: string) => void }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | undefined;
    let requested = false;
    const load = () => {
      if (requested || cancelled) return;
      requested = true;
      void (knowledge ? getProcedureKnowledgeImage(id) : getProcedureMaterialFile(id)).then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      }).catch(() => { if (!cancelled) setFailed(true); });
    };
    let observer: IntersectionObserver | undefined;
    if (typeof IntersectionObserver === 'undefined') load();
    else {
      observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer?.disconnect();
          load();
        }
      });
      if (cardRef.current) observer.observe(cardRef.current);
    }
    return () => {
      cancelled = true;
      observer?.disconnect();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id, knowledge]);
  return <div ref={cardRef} className="relative flex aspect-[4/3] items-center justify-center bg-gradient-to-br from-[#30404f] to-[#1b222a]">
    {url ? <img src={url} alt={alt} loading="lazy" className="h-full w-full object-contain" /> : <p className="text-lg text-[#9fadb9]">{failed ? '写真を取得できません' : '読込中…'}</p>}
    <button aria-label={`${alt}を原寸表示`} disabled={!url} className="absolute bottom-2.5 right-2.5 grid h-10 w-10 place-items-center rounded-lg border border-white/50 bg-black/45 text-lg text-white disabled:opacity-40" onClick={() => { if (url) onZoom(url, alt); }}>⤢</button>
  </div>;
}

function MaterialCard({ title, source, date, checked, disabled, onChange, children, detail }: {
  title: string; source: string; date?: string; checked: boolean; disabled: boolean;
  onChange: (checked: boolean) => void; children: ReactNode; detail?: ReactNode;
}) {
  return <li className={`relative overflow-hidden rounded-xl border border-[#344252] bg-[#1b222a] ${checked ? 'outline outline-[3px] -outline-offset-[3px] outline-[#3ba776]' : ''}`}>
    {children}
    <input type="checkbox" aria-label={title} checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} className="absolute left-2.5 top-2.5 h-[34px] w-[34px] cursor-pointer accent-[#3ba776] disabled:cursor-default" />
    <div className="flex min-h-12 min-w-0 items-center gap-2.5 px-3 py-2.5 text-[17px] text-[#9fadb9]">
      <b className="min-w-0 flex-1 truncate text-[19px] text-[#eef3f6]" title={title}>{title}</b>
      <span className="shrink-0 rounded-full border border-[#344252] px-2 py-0.5 text-sm">{source}</span>
      {date ? <time className="shrink-0" dateTime={date}>{new Date(date).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</time> : null}
    </div>
    {detail ? <div className="px-3 pb-2 text-sm text-[#9fadb9]">{detail}</div> : null}
  </li>;
}

const shelfSizeKey = 'procedure-material-shelf-size';
type ShelfSize = 'small' | 'medium' | 'large';
const shelfColumns = { small: 6, medium: 4, large: 3 };


export function ProcedureMaterialShelfDialog({ onClose, onSelect }: { onClose: () => void; onSelect?: (material: ProcedureMaterialDto) => Promise<void> }) {
  const selectionMode = Boolean(onSelect);
  const [size, setSize] = useState<ShelfSize>(() => {
    try { const saved = localStorage.getItem(shelfSizeKey); if (saved === 'small' || saved === 'large') return saved; } catch { /* Storage is optional on kiosks. */ }
    return 'medium';
  });
  const changeSize = (next: ShelfSize) => {
    setSize(next);
    try { localStorage.setItem(shelfSizeKey, next); } catch { /* Keep the in-memory setting. */ }
  };
  const [lightbox, setLightbox] = useState<{ url: string; title: string } | null>(null);
  const [discardConfirm, setDiscardConfirm] = useState(false);
  const zoom = (url: string, title: string) => setLightbox({ url, title });
  const toggleSelected = (id: string, checked: boolean) => setSelected((ids) => checked ? [...ids, id] : ids.filter((item) => item !== id));
  const [materials, setMaterials] = useState<ProcedureMaterialDto[]>([]);
  const [q, setQ] = useState('');
  const [state, setState] = useState<ProcedureMaterialState | 'knowledge'>('unplaced');
  const [knowledge, setKnowledge] = useState<ProcedureKnowledgeCandidatesResult | null>(null);
  const [knowledgeQ, setKnowledgeQ] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [knowledgeResult, setKnowledgeResult] = useState<ProcedureKnowledgeImportResult | null>(null);
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ProcedureMaterialIngestResult | null>(null);
  useEffect(() => {
    if (state === 'knowledge') return;
    let cancelled = false;
    setLoading(true);
    setMaterials([]);
    setSelected([]);
    setError(null);
    void listProcedureMaterials({ state, q, limit: 500 }).then((next) => { if (!cancelled) setMaterials(next); })
      .catch((e: unknown) => { if (!cancelled) setError(isAxiosError(e) && e.response?.status === 403 ? '権限がありません' : readAssemblyApiErrorMessage(e, '素材を取得できません')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [q, state, version, selectionMode]);

  useEffect(() => {
    if (state !== 'knowledge') return;
    let cancelled = false;
    setLoading(true); setKnowledge(null); setSelected([]); setError(null);
    void listProcedureKnowledgeCandidates({ q: knowledgeQ, limit: 100 }).then((next) => { if (!cancelled) setKnowledge(next); })
      .catch((e: unknown) => { if (!cancelled) setError(isAxiosError(e) && e.response?.status === 403 ? '権限がありません' : readAssemblyApiErrorMessage(e, '候補を取得できません')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [knowledgeQ, state, version]);

  const importSelected = async () => {
    setBusy(true); setError(null); setKnowledgeResult(null);
    try {
      const next = await importProcedureKnowledge(selected);
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
        const material = materials.find((item) => item.id === id);
        if (!material) continue;
        await onSelect(material);
        setSelected((ids) => ids.filter((item) => item !== id));
        setMaterials((items) => items.filter((item) => item.id !== id));
      }
      onClose();
    } catch (e) { setError(isAxiosError(e) && e.response?.status === 403 ? '権限がありません' : readAssemblyApiErrorMessage(e, '素材を配置できません')); }
    finally { setBusy(false); }
  };
  const discardSelected = async () => {
    setDiscardConfirm(false); setBusy(true); setError(null);
    try {
      for (const id of selected) {
        await discardProcedureMaterial(id);
        setSelected((ids) => ids.filter((item) => item !== id));
        setMaterials((items) => items.filter((item) => item.id !== id));
      }
      setVersion((v) => v + 1);
    } catch (e) { setError(readAssemblyApiErrorMessage(e, '素材を変更できません')); }
    finally { setBusy(false); }
  };
  const toolClass = 'h-11 shrink-0 rounded-lg border border-[#344252] px-3.5 text-[19px] font-bold disabled:opacity-40';
  return (
    <>
    <Dialog isOpen onClose={() => { if (!busy) onClose(); }} ariaLabel="素材" size="full" closeOnEsc={!lightbox && !discardConfirm && !busy} closeOnBackdrop={!busy && !lightbox && !discardConfirm} trapFocus={!lightbox && !discardConfirm} className="!mx-auto !my-[calc((100dvh-min(980px,92dvh))/2-1rem)] flex !h-[min(980px,92dvh)] min-h-0 !max-h-[92dvh] !w-[min(1760px,92vw)] flex-col gap-[18px] !rounded-[14px] !border !border-[#344252] !bg-[#161c22] !px-[26px] !py-6 !text-[#eef3f6]">
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <h2 className="text-2xl font-black">素材</h2>
        <div role="tablist" aria-label="素材の種類" className="ml-2 flex gap-1">
          {([['unplaced', `未配置${state === 'unplaced' && !loading ? ` (${materials.length}${materials.length === 500 ? '+' : ''})` : ''}`], ...(!selectionMode ? [['placed', '配置済み']] as const : []), ['knowledge', 'ナレッジから']] as const).map(([value, label]) => <button key={value} role="tab" aria-selected={state === value} disabled={busy} className={`h-11 whitespace-nowrap rounded-lg px-4 text-[19px] font-bold ${state === value ? 'bg-[#27313b] text-[#eef3f6]' : 'text-[#9fadb9]'}`} onClick={() => setState(value)}>{label}</button>)}
        </div>
        <Input type="search" disabled={busy} aria-label={state === 'knowledge' ? 'ナレッジ検索' : '素材のヒント検索'} placeholder="ヒントで絞り込み" className="ml-4 h-11 !w-80 text-xl" maxLength={200} value={state === 'knowledge' ? knowledgeQ : q} onChange={(e) => state === 'knowledge' ? setKnowledgeQ(e.target.value) : setQ(e.target.value)} />
        <div role="group" aria-label="表示サイズ" className="ml-auto flex items-center gap-1 text-[17px] text-[#9fadb9]">表示 {([['small', '小'], ['medium', '中'], ['large', '大']] as const).map(([value, label]) => <button key={value} aria-pressed={size === value} className={`h-11 w-11 rounded-lg border border-[#344252] text-base font-bold text-[#eef3f6] ${size === value ? 'bg-[#27313b]' : ''}`} onClick={() => changeSize(value)}>{label}</button>)}</div>
        <button className={`${toolClass} border-transparent text-[#9fadb9]`} disabled={busy} onClick={() => void runNow()}>{busy ? '処理中…' : '今すぐ取り込む'}</button>
        <button className={`${toolClass} border-transparent text-[#9fadb9]`} disabled={busy} onClick={onClose}>閉じる</button>
      </div>
      <div className="flex shrink-0 items-center gap-3 text-[19px] text-[#9fadb9]">
        <span role="status" aria-label="選択中の素材"><b className="font-mono font-medium text-[#eef3f6]">{selected.length}</b> 件を選択中</span>
        <div className="flex-1" />
        {!selectionMode ? <button className={`${toolClass} border-transparent text-[#9fadb9]`} aria-pressed={state === 'discarded'} disabled={busy} onClick={() => setState('discarded')}>捨てた素材</button> : null}
        {state === 'knowledge' ? <button className={`${toolClass} bg-[#3ba776] text-[#0b1a12]`} disabled={busy || !selected.length} onClick={() => void importSelected()}>棚に取り込む</button> : state === 'unplaced' ? <>
          <button className={`${toolClass} !h-[52px] !rounded-[10px] !px-[22px] !text-[21px]`} disabled={busy || !selected.length} onClick={() => setDiscardConfirm(true)}>捨てる</button>
          {onSelect ? <button className={`${toolClass} !h-[52px] !rounded-[10px] bg-[#3ba776] !px-[22px] !text-[21px] text-[#0b1a12]`} disabled={busy || !selected.length} onClick={() => void placeSelected()}>現在ページに配置</button> : null}
        </> : null}
      </div>
      {error ? <p role="alert" className="shrink-0 text-sm text-red-400">{error}</p> : null}
      {knowledgeResult ? <div role="status" className="max-h-24 shrink-0 overflow-auto text-sm text-[#9fadb9]">
        <p>取込 {knowledgeResult.imported}件・取込済み {knowledgeResult.duplicate}件・失敗 {knowledgeResult.failed.length}件</p>
        {knowledgeResult.failed.map((failure) => <p key={failure.candidateKey}>{failure.reason}</p>)}
      </div> : null}
      {result ? <div role="status" className="max-h-24 shrink-0 overflow-auto text-sm text-[#9fadb9]">
        <p>取込 {result.saved}件・保存済み {result.duplicate}件・スキップ {result.skipped}通・再試行 {result.retryable}通・除外添付 {result.skippedAttachments}件</p>
        {result.messages.filter((m) => m.reason).map((m) => <p key={m.messageId}>{m.reason}</p>)}
      </div> : null}
      <div className="min-h-0 flex-1 overflow-auto" aria-label="素材一覧">
        {loading ? <p role="status">読込中…</p> : state === 'knowledge' ? knowledge?.enabled === false ? <p>ナレッジ機能は無効です</p> : !error && !knowledge?.items.length ? <p>候補がありません</p> : null : !error && materials.length === 0 ? <p>素材がありません</p> : null}
        <ul className="grid content-start gap-3.5 pr-1" style={{ gridTemplateColumns: `repeat(${shelfColumns[size]}, minmax(0, 1fr))` }}>
          {state === 'knowledge' ? knowledge?.items.map((candidate) => <MaterialCard key={candidate.candidateKey} title={candidate.title} source="ナレッジ" checked={selected.includes(candidate.candidateKey)} disabled={busy || candidate.alreadyImported || (!selected.includes(candidate.candidateKey) && selected.length >= 50)} onChange={(checked) => toggleSelected(candidate.candidateKey, checked)} detail={<>{candidate.summary ? <p className="line-clamp-2">{candidate.summary}</p> : null}<p>{candidate.kind === 'PHOTO' && candidate.preview ? <span className="line-clamp-2">{candidate.preview}</span> : null}{candidate.sourceLabel}{candidate.alreadyImported ? ' · 取込済み' : ''}</p></>}>
            {candidate.kind === 'PHOTO' && candidate.imageId ? <MaterialPhoto id={candidate.imageId} alt={candidate.title} knowledge onZoom={zoom} /> : <div className="aspect-[4/3] overflow-hidden bg-[#fdfcf7] p-4 pt-14 text-[19px] leading-normal text-[#1a1a1a]"><p className="line-clamp-6 whitespace-pre-wrap break-words">{candidate.preview}</p></div>}
          </MaterialCard>) : materials.map((material) => <MaterialCard key={material.id} title={material.subjectHint || material.originalFileName || 'ヒントなし'} source={material.origin === 'KNOWLEDGE' ? 'ナレッジ' : 'メール'} date={material.receivedAt} checked={selected.includes(material.id)} disabled={busy || state !== 'unplaced'} onChange={(checked) => toggleSelected(material.id, checked)} detail={state === 'placed' || state === 'discarded' ? <Button variant="ghostOnDark" className="min-h-11" disabled={busy} onClick={() => void toggleDiscard(material)}>{state === 'placed' ? '配置を取り消す' : '戻す'}</Button> : undefined}>
            {material.kind === 'PHOTO' ? <MaterialPhoto id={material.id} alt={material.originalFileName || '素材の写真'} onZoom={zoom} /> : <div className="aspect-[4/3] overflow-hidden bg-[#fdfcf7] p-4 pt-14 text-[19px] leading-normal text-[#1a1a1a]"><p className="line-clamp-6 whitespace-pre-wrap break-words">{material.text}</p></div>}
          </MaterialCard>)}
        </ul>
      </div>
    </Dialog>
    {lightbox ? <Dialog isOpen title={lightbox.title} ariaLabel="素材の原寸表示" size="full" overlayZIndex={60} className="flex min-h-0 !h-[92dvh] flex-col !bg-[#161c22] !text-[#eef3f6]" onClose={() => setLightbox(null)}>
      <button className={`${toolClass} ml-auto mb-3`} onClick={() => setLightbox(null)}>閉じる</button>
      <div className="min-h-0 flex-1 overflow-auto"><img src={lightbox.url} alt={lightbox.title} className="mx-auto block max-w-none" /></div>
    </Dialog> : null}
    {discardConfirm ? <Dialog isOpen title="素材を捨てる" overlayZIndex={60} onClose={() => setDiscardConfirm(false)}>
      <p className="my-3">選択した {selected.length} 件を捨てますか？捨てた素材から戻せます。</p>
      <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setDiscardConfirm(false)}>キャンセル</Button><Button variant="danger" onClick={() => void discardSelected()}>捨てる</Button></div>
    </Dialog> : null}
    </>
  );
}
