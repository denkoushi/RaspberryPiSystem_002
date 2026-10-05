import { useState } from 'react';

import { ProcedureVideoPlaybackDialog } from './ProcedureVideoPlaybackDialog';
import { ProcedureVideoThumbnail } from './ProcedureVideoThumbnail';

import type { ProcedureVideoSummaryDto } from './procedure-video-types';

export function ProcedurePageVideoStrip({ videos, layout }: { videos: ProcedureVideoSummaryDto[]; layout?: 'manuals' }) {
  const [playing, setPlaying] = useState<ProcedureVideoSummaryDto | null>(null);
  const ready = videos.filter((video) => video.status === 'READY');
  if (!ready.length) return null;
  return <section aria-label="このページの動画" className="shrink-0">
    {layout === 'manuals' ? <h3>動画</h3> : null}
    <div className="flex gap-2 overflow-x-auto p-2">{ready.map((video) => <button key={video.id} aria-label={video.title} title={video.title} className="flex min-h-11 shrink-0 items-center gap-2 rounded border border-slate-500 p-1 text-sm" onClick={() => setPlaying(video)}><span className="relative"><ProcedureVideoThumbnail id={video.id} title={video.title} durationSeconds={video.durationSeconds} className={layout === 'manuals' ? 'h-[70px] w-28' : undefined} />{layout === 'manuals' ? <span aria-hidden="true" className="absolute bottom-1 left-1 text-white">▶</span> : null}</span>{layout !== 'manuals' ? <span>{video.title}</span> : null}</button>)}</div>
    {playing ? <ProcedureVideoPlaybackDialog video={playing} onClose={() => setPlaying(null)} /> : null}
  </section>;
}
