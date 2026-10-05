import { isAxiosError } from 'axios';
import { useEffect, useRef, useState } from 'react';

import { discardProcedureMaterial, getProcedureMaterialFile, getProcedureKnowledgeImage, importProcedureKnowledge, ingestProcedureMaterialsGmail, listProcedureKnowledgeCandidates, listProcedureMaterials, restoreProcedureMaterial, unplaceProcedureMaterial } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { Dialog } from '../../../components/ui/Dialog';
import { Input } from '../../../components/ui/Input';
import { readAssemblyApiErrorMessage } from '../assemblyUiHelpers';

import type { ProcedureKnowledgeCandidatesResult, ProcedureKnowledgeImportResult, ProcedureMaterialDto, ProcedureMaterialIngestResult, ProcedureMaterialState } from './procedure-material-types';

function MaterialPhoto({ id, alt, knowledge = false }: { id: string; alt: string; knowledge?: boolean }) {
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
  return <div ref={cardRef}>{url ? <img src={url} alt={alt} loading="lazy" className="h-24 w-32 rounded object-contain" />
    : <p className="flex h-24 w-32 items-center text-sm text-slate-600">{failed ? '写真を取得できません' : '読込中…'}</p>}</div>;
}

export function ProcedureMaterialShelfDialog({ onClose, onSelect }: { onClose: () => void; onSelect?: (material: ProcedureMaterialDto) => Promise<void> }) {
  const selectionMode = Boolean(onSelect);
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
    setError(null);
    void listProcedureMaterials({ state: selectionMode ? 'unplaced' : state, q, limit: 40 }).then((next) => { if (!cancelled) setMaterials(next); })
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
  const selectMaterial = async (material: ProcedureMaterialDto) => {
    if (!onSelect || busy) return;
    setBusy(true); setError(null);
    try { await onSelect(material); onClose(); }
    catch (e) { setError(isAxiosError(e) && e.response?.status === 403 ? '権限がありません' : readAssemblyApiErrorMessage(e, '素材を配置できません')); }
    finally { setBusy(false); }
  };
  return (
    <Dialog isOpen onClose={onClose} title="素材" size="lg" className="flex min-h-0 flex-col">
      <div className="mt-3 flex shrink-0 flex-wrap items-center gap-2">
        <Input disabled={busy} aria-label={state === 'knowledge' ? 'ナレッジ検索' : '素材のヒント検索'} placeholder={state === 'knowledge' ? '品番・工程・本文で検索' : 'ヒントで検索'} className="min-h-11 min-w-0 flex-1" maxLength={200} value={state === 'knowledge' ? knowledgeQ : q} onChange={(e) => state === 'knowledge' ? setKnowledgeQ(e.target.value) : setQ(e.target.value)} />
        {state === 'knowledge' ? <Button className="min-h-11 shrink-0" disabled={busy || !selected.length} onClick={() => void importSelected()}>{busy ? '処理中…' : '棚に取り込む'}</Button> : <Button variant="secondary" className="min-h-11 shrink-0" disabled={busy} onClick={() => void runNow()}>{busy ? '処理中…' : '今すぐ取り込む'}</Button>}
        <Button variant="ghost" className="min-h-11 shrink-0" onClick={onClose}>閉じる</Button>
      </div>
      <div className="mt-2 flex shrink-0 flex-wrap gap-2">
        {([['unplaced', '未配置'], ...(!selectionMode ? [['placed', '配置済み'], ['discarded', '捨てた素材']] as const : []), ['knowledge', 'ナレッジから']] as const).map(([value, label]) =>
          <Button key={value} variant={state === value ? 'primary' : 'ghost'} className="min-h-11" aria-pressed={state === value} disabled={busy} onClick={() => setState(value)}>{label}</Button>)}
      </div>
      {error ? <p role="alert" className="mt-2 shrink-0 text-sm text-red-700">{error}</p> : null}
      {knowledgeResult ? <div role="status" className="mt-2 max-h-24 shrink-0 overflow-auto text-sm text-slate-600">
        <p>取込 {knowledgeResult.imported}件・取込済み {knowledgeResult.duplicate}件・失敗 {knowledgeResult.failed.length}件</p>
        {knowledgeResult.failed.map((failure) => <p key={failure.candidateKey}>{failure.reason}</p>)}
      </div> : null}
      {state !== 'knowledge' && result ? <div role="status" className="mt-2 max-h-24 shrink-0 overflow-auto text-sm text-slate-600">
        <p>取込 {result.saved}件・保存済み {result.duplicate}件・スキップ {result.skipped}通・再試行 {result.retryable}通・除外添付 {result.skippedAttachments}件</p>
        {result.messages.filter((m) => m.reason).map((m) => <p key={m.messageId}>{m.reason}</p>)}
      </div> : null}
      <div className="mt-3 min-h-0 flex-1 overflow-auto" aria-label="素材一覧">
        {state === 'knowledge' ? <>
          {loading ? <p role="status">読込中…</p> : knowledge?.enabled === false ? <p>ナレッジ機能は無効です</p> : !error && !knowledge?.items.length ? <p>候補がありません</p> : null}
          <ul className="space-y-2">
            {knowledge?.items.map((candidate) => <li key={candidate.candidateKey} className={`rounded border border-slate-300 p-3 ${candidate.alreadyImported ? 'bg-slate-100 text-slate-500' : ''}`}>
              <label className="flex min-h-11 items-start gap-3">
                <input type="checkbox" className="mt-1 h-6 w-6 shrink-0" aria-label={candidate.title} disabled={busy || candidate.alreadyImported || (!selected.includes(candidate.candidateKey) && selected.length >= 50)} checked={selected.includes(candidate.candidateKey)} onChange={(e) => setSelected((keys) => e.target.checked ? [...keys, candidate.candidateKey] : keys.filter((key) => key !== candidate.candidateKey))} />
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm font-medium">{candidate.title}</p>
                  {candidate.summary ? <p className="line-clamp-2 break-words text-sm text-slate-600">{candidate.summary}</p> : null}
                  {candidate.kind === 'PHOTO' && candidate.imageId ? <MaterialPhoto id={candidate.imageId} alt={candidate.title} knowledge /> : null}
                  <p className="line-clamp-2 whitespace-pre-wrap break-words text-sm">{candidate.preview}</p>
                  <p className="mt-2 text-xs">{candidate.sourceLabel}{candidate.alreadyImported ? ' · 取込済み' : ''}</p>
                </div>
              </label>
            </li>)}
          </ul>
        </> : <>
        {loading ? <p role="status">読込中…</p> : !error && materials.length === 0 ? <p className="text-sm text-slate-600">素材がありません</p> : null}
        <ul className="space-y-2">
          {materials.map((material) => <li key={material.id} className="flex items-start gap-3 rounded border border-slate-300 p-3">
            <div className="min-w-0 flex-1">
              {material.kind === 'PHOTO' ? <MaterialPhoto id={material.id} alt={material.originalFileName || '素材の写真'} /> : <p className="line-clamp-2 whitespace-pre-wrap break-words text-sm">{material.text}</p>}
              <p className="mt-2 text-xs text-slate-600">{material.origin === 'KNOWLEDGE' ? 'ナレッジ' : 'メール'}</p>
              <p className="mt-2 truncate text-xs text-slate-600" title={material.subjectHint ?? undefined}>{material.subjectHint || 'ヒントなし'}</p>
              <p className="truncate text-xs text-slate-600">{new Date(material.receivedAt).toLocaleString('ja-JP')} · {material.fromEmail || '送信元不明'}</p>
            </div>
            {onSelect ? <Button className="min-h-11 shrink-0" disabled={busy} onClick={() => void selectMaterial(material)}>配置</Button>
              : <Button variant="ghost" className="min-h-11 shrink-0" disabled={busy} onClick={() => void toggleDiscard(material)}>{material.documentId || material.placedAt ? '配置を取り消す' : material.discardedAt ? '戻す' : '捨てる'}</Button>}
          </li>)}
        </ul>
        </>}
      </div>
    </Dialog>
  );
}
