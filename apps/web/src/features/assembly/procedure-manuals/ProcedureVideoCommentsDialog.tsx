import { useEffect, useRef, useState } from 'react';

import { getProcedureVideoComments, replaceProcedureVideoComments } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { Dialog } from '../../../components/ui/Dialog';
import { Input } from '../../../components/ui/Input';
import { readAssemblyApiErrorMessage } from '../assemblyUiHelpers';

import { ProcedureVideoPlayer } from './ProcedureVideoPlayer';

import type { ProcedureVideoCommentDto, ProcedureVideoSummaryDto } from './procedure-video-types';

export function ProcedureVideoCommentsDialog({ video, onClose, onSaved }: { video: ProcedureVideoSummaryDto; onClose: () => void; onSaved: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [comments, setComments] = useState<ProcedureVideoCommentDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void getProcedureVideoComments(video.id).then((rows) => { if (!cancelled) { setComments(rows); setLoading(false); } })
      .catch((e: unknown) => { if (!cancelled) setError(readAssemblyApiErrorMessage(e, 'コメントを取得できません')); });
    return () => { cancelled = true; };
  }, [video.id]);
  const save = async () => {
    setBusy(true); setError(null);
    try { await replaceProcedureVideoComments(video.id, comments); onSaved(); }
    catch (e) { setError(readAssemblyApiErrorMessage(e, 'コメントを保存できません')); }
    finally { setBusy(false); }
  };
  return <Dialog isOpen onClose={() => { if (!busy) onClose(); }} title="場面コメントの編集" size="lg" className="overflow-y-auto">
    <ProcedureVideoPlayer video={video} videoRef={videoRef} comments={comments.filter((comment) => comment.text.trim())} />
    <p className="mt-2 text-sm">短い文で入力してください（80文字、5件まで）。</p>
    <fieldset disabled={loading || busy} className="mt-2 space-y-2">
      {comments.map((comment, index) => <div key={index} className="flex flex-wrap items-center gap-2">
        <Input aria-label={`コメント${index + 1}の秒数`} type="number" step={0.1} min={0} max={video.durationSeconds ?? 0} value={comment.atSeconds} className="w-24" onChange={(e) => setComments((rows) => rows.map((row, i) => i === index ? { ...row, atSeconds: Number(e.target.value) } : row))} />
        <Input aria-label={`コメント${index + 1}の文`} maxLength={80} value={comment.text} className="min-w-40 flex-1" onChange={(e) => setComments((rows) => rows.map((row, i) => i === index ? { ...row, text: e.target.value } : row))} />
        <Button className="min-h-11" aria-label={`コメント${index + 1}を削除`} onClick={() => setComments((rows) => rows.filter((_, i) => i !== index))}>削除</Button>
      </div>)}
      <Button className="min-h-11" disabled={comments.length >= 5 || video.durationSeconds == null} onClick={() => setComments((rows) => [...rows, { atSeconds: Math.min(video.durationSeconds ?? 0, videoRef.current?.currentTime ?? 0), text: '' }])}>現在位置に追加</Button>
      <Button className="ml-2 min-h-11" disabled={comments.some((comment) => !comment.text.trim() || comment.text.trim().length > 80 || comment.atSeconds < 0 || comment.atSeconds > (video.durationSeconds ?? 0))} onClick={() => void save()}>保存</Button>
    </fieldset>
    {loading && !error ? <p role="status">コメントを読込中…</p> : null}
    {error ? <p role="alert" className="mt-2 text-red-700">{error}</p> : null}
    <Button className="mt-3 min-h-11" disabled={busy} onClick={onClose}>閉じる</Button>
  </Dialog>;
}
