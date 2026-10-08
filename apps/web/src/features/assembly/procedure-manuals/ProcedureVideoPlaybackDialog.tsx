import { Button } from '../../../components/ui/Button';
import { Dialog } from '../../../components/ui/Dialog';

import { ProcedureVideoPlayer } from './ProcedureVideoPlayer';

import type { ProcedureVideoSummaryDto, ProcedureVideoRange } from './procedure-video-types';

export function ProcedureVideoPlaybackDialog({ video, range, onClose }: { video: Pick<ProcedureVideoSummaryDto, 'id' | 'title' | 'durationSeconds' | 'status'>; range?: ProcedureVideoRange; onClose: () => void }) {
  return <Dialog isOpen onClose={onClose} title={video.title} size="lg" className="overflow-y-auto !bg-slate-900 !text-slate-100">
    <ProcedureVideoPlayer video={video} range={range} />
    <Button className="mt-3 min-h-11" onClick={onClose}>閉じる</Button>
  </Dialog>;
}
