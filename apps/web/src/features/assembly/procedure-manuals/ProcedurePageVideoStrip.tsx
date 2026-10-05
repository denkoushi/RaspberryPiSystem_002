import { useState } from 'react';

import { ProcedureVideoPlaybackDialog } from './ProcedureVideoPlaybackDialog';
import { ProcedureVideoThumbnail } from './ProcedureVideoThumbnail';

import type { ProcedureVideoSummaryDto } from './procedure-video-types';

export function ProcedurePageVideoStrip({ videos }: { videos: ProcedureVideoSummaryDto[] }) {
  const [playing, setPlaying] = useState<ProcedureVideoSummaryDto | null>(null);
  const ready = videos.filter((video) => video.status === 'READY');
  if (!ready.length) return null;
  return <section aria-label="このページの動画" className="shrink-0">
    <div className="flex gap-2 overflow-x-auto p-2">{ready.map((video) => <button key={video.id} className="flex min-h-11 shrink-0 items-center gap-2 rounded border border-slate-500 p-1 text-sm" onClick={() => setPlaying(video)}><ProcedureVideoThumbnail id={video.id} title={video.title} durationSeconds={video.durationSeconds} /><span>{video.title}</span></button>)}</div>
    {playing ? <ProcedureVideoPlaybackDialog video={playing} onClose={() => setPlaying(null)} /> : null}
  </section>;
}
