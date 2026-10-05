import { isAxiosError } from 'axios';
import { useEffect, useRef, useState } from 'react';

import { discardProcedureMaterial, getProcedureMaterialFile, ingestProcedureMaterialsGmail, listProcedureMaterials, restoreProcedureMaterial } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { Dialog } from '../../../components/ui/Dialog';
import { Input } from '../../../components/ui/Input';
import { readAssemblyApiErrorMessage } from '../assemblyUiHelpers';

import type { ProcedureMaterialDto, ProcedureMaterialIngestResult } from './procedure-material-types';

function MaterialPhoto({ material }: { material: ProcedureMaterialDto }) {
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
      void getProcedureMaterialFile(material.id).then((blob) => {
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
  }, [material.id]);
  return <div ref={cardRef}>{url ? <img src={url} alt={material.originalFileName || '素材の写真'} loading="lazy" className="h-24 w-32 rounded object-contain" />
    : <p className="flex h-24 w-32 items-center text-sm text-slate-600">{failed ? '写真を取得できません' : '読込中…'}</p>}</div>;
}

export function ProcedureMaterialShelfDialog({ onClose }: { onClose: () => void }) {
  const [materials, setMaterials] = useState<ProcedureMaterialDto[]>([]);
  const [q, setQ] = useState('');
  const [discarded, setDiscarded] = useState(false);
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ProcedureMaterialIngestResult | null>(null);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMaterials([]);
    setError(null);
    void listProcedureMaterials({ state: discarded ? 'discarded' : 'unplaced', q, limit: 40 }).then((next) => { if (!cancelled) setMaterials(next); })
      .catch((e: unknown) => { if (!cancelled) setError(isAxiosError(e) && e.response?.status === 403 ? '権限がありません' : readAssemblyApiErrorMessage(e, '素材を取得できません')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [q, discarded, version]);

  const runNow = async () => {
    setBusy(true); setError(null); setResult(null);
    try { setResult(await ingestProcedureMaterialsGmail()); setVersion((v) => v + 1); }
    catch (e) { setError(isAxiosError(e) && e.response?.status === 403 ? '権限がありません' : readAssemblyApiErrorMessage(e, '取込に失敗しました')); }
    finally { setBusy(false); }
  };
  const toggleDiscard = async (material: ProcedureMaterialDto) => {
    setBusy(true); setError(null);
    try {
      if (material.discardedAt) await restoreProcedureMaterial(material.id);
      else await discardProcedureMaterial(material.id);
      setVersion((v) => v + 1);
    } catch (e) { setError(isAxiosError(e) && e.response?.status === 403 ? '権限がありません' : readAssemblyApiErrorMessage(e, '素材を変更できません')); }
    finally { setBusy(false); }
  };
  return (
    <Dialog isOpen onClose={onClose} title="素材" size="lg" className="flex min-h-0 flex-col">
      <div className="mt-3 flex shrink-0 flex-wrap items-center gap-2">
        <Input aria-label="素材のヒント検索" placeholder="ヒントで検索" className="min-h-11 min-w-0 flex-1" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button variant="secondary" className="min-h-11 shrink-0" disabled={busy} onClick={() => void runNow()}>{busy ? '処理中…' : '今すぐ取り込む'}</Button>
        <Button variant="ghost" className="min-h-11 shrink-0" onClick={onClose}>閉じる</Button>
      </div>
      <div className="mt-2 flex shrink-0 gap-2">
        <Button variant={discarded ? 'ghost' : 'primary'} className="min-h-11" aria-pressed={!discarded} onClick={() => setDiscarded(false)}>未配置</Button>
        <Button variant={discarded ? 'primary' : 'ghost'} className="min-h-11" aria-pressed={discarded} onClick={() => setDiscarded(true)}>捨てた素材</Button>
      </div>
      {error ? <p role="alert" className="mt-2 shrink-0 text-sm text-red-700">{error}</p> : null}
      {result ? <div role="status" className="mt-2 max-h-24 shrink-0 overflow-auto text-sm text-slate-600">
        <p>取込 {result.saved}件・保存済み {result.duplicate}件・スキップ {result.skipped}通・再試行 {result.retryable}通・除外添付 {result.skippedAttachments}件</p>
        {result.messages.filter((m) => m.reason).map((m) => <p key={m.messageId}>{m.reason}</p>)}
      </div> : null}
      <div className="mt-3 min-h-0 flex-1 overflow-auto" aria-label="素材一覧">
        {loading ? <p role="status">読込中…</p> : !error && materials.length === 0 ? <p className="text-sm text-slate-600">素材がありません</p> : null}
        <ul className="space-y-2">
          {materials.map((material) => <li key={material.id} className="flex items-start gap-3 rounded border border-slate-300 p-3">
            <div className="min-w-0 flex-1">
              {material.kind === 'PHOTO' ? <MaterialPhoto material={material} /> : <p className="line-clamp-2 whitespace-pre-wrap break-words text-sm">{material.text}</p>}
              <p className="mt-2 truncate text-xs text-slate-600" title={material.subjectHint ?? undefined}>{material.subjectHint || 'ヒントなし'}</p>
              <p className="truncate text-xs text-slate-600">{new Date(material.receivedAt).toLocaleString('ja-JP')} · {material.fromEmail || '送信元不明'}</p>
            </div>
            <Button variant="ghost" className="min-h-11 shrink-0" disabled={busy || Boolean(material.documentId || material.placedAt)} onClick={() => void toggleDiscard(material)}>{material.discardedAt ? '戻す' : '捨てる'}</Button>
          </li>)}
        </ul>
      </div>
    </Dialog>
  );
}
