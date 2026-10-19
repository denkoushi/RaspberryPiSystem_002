import { useState } from 'react';

import { concatProcedureVideos } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { Dialog } from '../../../components/ui/Dialog';
import { Input } from '../../../components/ui/Input';
import { readAssemblyApiErrorMessage } from '../assemblyUiHelpers';

import type { ProcedureVideoDto } from './procedure-video-types';

export function ProcedureVideoConcatDialog({ videos, onClose, onSaved }: { videos: ProcedureVideoDto[]; onClose: () => void; onSaved: () => void }) {
  const [ordered, setOrdered] = useState(videos);
  const [title, setTitle] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const defaultTitle = `${ordered[0].title} ほか ${ordered.length - 1} 本`;
  const total = ordered.every((video) => video.durationSeconds != null) ? ordered.reduce((sum, video) => sum + (video.durationSeconds ?? 0), 0) : null;
  const reorder = (index: number, offset: number) => {
    setOrdered((items) => { const next = [...items]; [next[index], next[index + offset]] = [next[index + offset], next[index]]; return next; });
  };
  const submit = async () => {
    setBusy(true); setError(null);
    try { await concatProcedureVideos(ordered.map((video) => video.id), title?.trim() || undefined); onSaved(); }
    catch (e) { setError(readAssemblyApiErrorMessage(e, '接続を開始できません')); }
    finally { setBusy(false); }
  };
  return <Dialog isOpen onClose={() => { if (!busy) onClose(); }} closeOnBackdrop={!busy} title="動画の接続" size="lg" className="overflow-y-auto">
    <p className="mt-2 text-sm">2〜5本を順につなぎます。元の動画はそのまま残ります。</p>
    <section aria-label="接続順" className="mt-3 space-y-2">
      {ordered.map((video, index) => <div key={index} className="flex flex-wrap items-center gap-2 border-b py-1">
        <span className="min-w-0 flex-1 break-words">{index + 1}. {video.title}（{video.durationSeconds == null ? '長さ未確認' : `${video.durationSeconds.toFixed(1)}秒`}）</span>
        <Button className="min-h-11" aria-label={`${video.title}を上へ`} disabled={busy || index === 0} onClick={() => reorder(index, -1)}>↑</Button>
        <Button className="min-h-11" aria-label={`${video.title}を下へ`} disabled={busy || index === ordered.length - 1} onClick={() => reorder(index, 1)}>↓</Button>
      </div>)}
    </section>
    <p role="status" aria-label="合計の長さ" className="mt-2 font-semibold">合計 {total == null ? '長さ未確認' : `${total.toFixed(1)}秒`}</p>
    <label className="mt-3 block">題名（任意）<Input aria-label="接続動画の題名" maxLength={200} disabled={busy} value={title ?? defaultTitle} placeholder={defaultTitle} onChange={(e) => setTitle(e.target.value)} /></label>
    <p className="mt-1 text-sm">空欄の場合: {defaultTitle}</p>
    {error ? <p role="alert" className="mt-2 text-red-700">{error}</p> : null}
    <div className="mt-3 flex gap-2">
      <Button className="min-h-11" disabled={busy || ordered.length < 2 || ordered.length > 5} onClick={() => void submit()}>接続する</Button>
      <Button className="min-h-11" disabled={busy} onClick={onClose}>閉じる</Button>
    </div>
    {busy ? <p role="status">接続を依頼中…</p> : null}
  </Dialog>;
}
