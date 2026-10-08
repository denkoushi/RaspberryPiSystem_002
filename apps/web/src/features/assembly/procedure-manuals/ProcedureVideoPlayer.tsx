import { useEffect, useRef, useState, type RefObject } from 'react';

import { getProcedureVideoComments, getProcedureVideoFile } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { readAssemblyApiErrorMessage } from '../assemblyUiHelpers';

import { procedureVideoTime, type ProcedureVideoCommentDto, type ProcedureVideoSummaryDto, type ProcedureVideoRange } from './procedure-video-types';

export function ProcedureVideoPlayer({ video, videoRef, comments: suppliedComments, range, controls = true, onTimeUpdate }: {
  video: Pick<ProcedureVideoSummaryDto, 'id' | 'title' | 'durationSeconds' | 'status'>; range?: ProcedureVideoRange; controls?: boolean; onTimeUpdate?: (player: HTMLVideoElement) => void; videoRef?: RefObject<HTMLVideoElement>; comments?: ProcedureVideoCommentDto[];
}) {
  const ownRef = useRef<HTMLVideoElement>(null);
  const ref = videoRef ?? ownRef;
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedComments, setLoadedComments] = useState<ProcedureVideoCommentDto[]>([]);
  const [commentError, setCommentError] = useState<string | null>(null);
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const start = range?.startSeconds, end = range?.endSeconds;
  useEffect(() => {
    if (start == null || !ref.current) return;
    ref.current.pause(); ref.current.currentTime = start; setPosition(start);
  }, [start, end, url, ref]);
  const track = (player: HTMLVideoElement) => {
    if (range && (player.currentTime < range.startSeconds || player.currentTime >= range.endSeconds)) player.currentTime = range.startSeconds;
    setPosition(player.currentTime);
    onTimeUpdate?.(player);
  };
  useEffect(() => {
    const abort = new AbortController();
    let objectUrl: string | undefined;
    setUrl(null); setError(null); setPosition(0);
    // Use an authenticated Blob so native controls can seek without URL tokens.
    void getProcedureVideoFile(video.id, abort.signal).then((blob) => {
      if (abort.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob); setUrl(objectUrl);
    }).catch((e: unknown) => { if (!abort.signal.aborted) setError(readAssemblyApiErrorMessage(e, '動画を取得できません')); });
    return () => { abort.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [video.id]);
  useEffect(() => {
    if (suppliedComments) return;
    let cancelled = false;
    setLoadedComments([]); setCommentError(null);
    void getProcedureVideoComments(video.id).then((rows) => { if (!cancelled) setLoadedComments(rows); })
      .catch((e: unknown) => { if (!cancelled) setCommentError(readAssemblyApiErrorMessage(e, 'コメントを取得できません')); });
    return () => { cancelled = true; };
  }, [video.id, suppliedComments]);
  const comments = [...(suppliedComments ?? loadedComments)].filter((comment) => !range || (comment.atSeconds >= range.startSeconds && comment.atSeconds < range.endSeconds)).sort((a, b) => a.atSeconds - b.atSeconds);
  const caption = comments.find((comment, index) => position >= comment.atSeconds && position < (comments[index + 1]?.atSeconds ?? comment.atSeconds + 4));
  return <>
    {error ? <p role="alert" className="mt-3 text-red-700">{error}</p> : url ? <div className="relative mt-3 bg-black">
      <video ref={ref} aria-label={video.title} controls={controls && !range} playsInline muted preload="metadata" src={url}
        onLoadedMetadata={(event) => { if (range) event.currentTarget.currentTime = range.startSeconds; }}
        onTimeUpdate={(event) => track(event.currentTarget)} onSeeking={(event) => track(event.currentTarget)} onSeeked={(event) => track(event.currentTarget)}
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={(event) => { onTimeUpdate?.(event.currentTarget); if (range) { event.currentTarget.currentTime = range.startSeconds; void event.currentTarget.play().catch(() => undefined); } }}
        className="max-h-[55dvh] w-full" />
      {caption ? <div data-testid="video-caption" className="pointer-events-none absolute bottom-12 left-0 right-0 bg-black/70 px-3 py-2 text-center text-white"><p className="line-clamp-2 whitespace-pre-wrap break-words">{caption.text}</p></div> : null}
    </div> : <p role="status" className="mt-3">動画を読込中…</p>}
    {range && url ? <div className="mt-2 flex items-center gap-3">
      <Button className="min-h-11 shrink-0" onClick={() => { const player = ref.current; if (!player) return; if (player.paused) void player.play().catch((e: unknown) => setError(readAssemblyApiErrorMessage(e, '再生できません'))); else player.pause(); }}>{playing ? '一時停止' : '再生'}</Button>
      <progress aria-label="場面の再生位置" className="h-2 min-w-0 flex-1 accent-amber-400" value={Math.max(0, Math.min(position - range.startSeconds, range.endSeconds - range.startSeconds))} max={range.endSeconds - range.startSeconds} />
      <span className="shrink-0 font-mono text-sm">{Math.max(0, position - range.startSeconds).toFixed(1)} / {(range.endSeconds - range.startSeconds).toFixed(1)}秒</span>
    </div> : null}
    {commentError ? <p role="alert" className="mt-2 text-red-700">{commentError}</p> : null}
    {comments.length ? <ul aria-label="場面コメント" className="mt-2 space-y-1">{comments.map((comment, index) => <li key={index}>
      <button className={`min-h-11 ${range ? '' : 'w-full'} rounded border px-3 py-2 text-left text-sm`} onClick={() => { if (ref.current) { ref.current.currentTime = comment.atSeconds; setPosition(comment.atSeconds); } }}>
        <span className="mr-2 font-mono">{procedureVideoTime(comment.atSeconds)}</span>{comment.text}
      </button>
    </li>)}</ul> : null}
  </>;
}
